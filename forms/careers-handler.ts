// careers-handler.ts must never import anything from integrations/ — CV and
// attachment submissions always go through AWS SES directly, never Leads
// Hub, regardless of whether LEADS_HUB_URL/LEADS_HUB_TOKEN are configured
// for this site's business-enquiry form. That's enforced structurally, not
// conventionally: this file has no code path that could reach Leads Hub
// even by mistake, because it has no reference to that module at all.
// Deliberately independent of forms/form-handler.ts too, so the two
// pipelines can be read, reasoned about, and audited in isolation.

import { sanitizeString, escapeHtml } from '../utils/sanitize.js';
import { validateFields, describeValidationErrors, FIELD_LABELS, CONTACT_SCHEMA_FULL, type ValidationSchema } from './validation.js';
import { verifyTurnstile } from '../security/turnstile-verify.js';
import { sendEmail, sendEmailWithAttachment, type SesConfig } from '../email/ses-email-service.js';
import { errorResponse, successResponse, serverError, type FormResponseData } from '../utils/error-handler.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CareersFields = {
  name: string;
  email: string;
  phone: string;
  position?: string;
  message?: string;
  /** Values for the keys a site declared in `extraFields`. Empty otherwise. */
  extra?: Record<string, string>;
};

/**
 * Forwards the application to a recruitment dashboard or CRM webhook, in
 * addition to the email. Best-effort by design: a failure here is logged and
 * swallowed, because the email is the record of the application and an
 * applicant must never see a dashboard outage as a failed submission.
 */
export type CareersDashboardConfig = {
  url: string;
  secret?: string;
};

export type CareersEmailConfig = {
  from: string;
  to: string | string[];
  bcc?: string | string[];
  siteName?: string;
};

export type CareersTurnstileConfig = {
  secretKey: string;
};

/** Static configuration — set once per project / environment. */
export type CareersConfig = {
  ses: SesConfig;
  email: CareersEmailConfig;
  /**
   * Extra form fields this site collects, as `request key -> label`. Nothing
   * here is assumed about what a site asks for: the keys are whatever its own
   * form posts, the labels are whatever it calls them in the email. Values are
   * sanitised and capped at 200 characters like any other field.
   *
   *   extraFields: { province: 'Province', site_region: 'Region' }
   */
  extraFields?: Record<string, string>;
  /** Forward the application onward as well as emailing it. */
  dashboard?: CareersDashboardConfig;
  turnstile?: CareersTurnstileConfig;
  validation?: ValidationSchema;
};

/** Per-request context — derived from each incoming request. */
export type CareersRequestContext = {
  clientIp?: string;
};

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024; // 7 MB — keeps total MIME under SES's 10 MB limit

// ─── Primary entry point ───────────────────────────────────────────────────────

export async function handleCareersSubmission(
  request: Request,
  config: CareersConfig,
  context?: CareersRequestContext
): Promise<Response> {
  try {
    const { fields, file, honeypot, turnstileToken } =
      await parseCareersRequest(request, Object.keys(config.extraFields ?? {}));

    if (honeypot) return errorResponse('Spam detected');

    if (config.turnstile) {
      const ts = await verifyTurnstile(config.turnstile.secretKey, turnstileToken, context?.clientIp);
      if (!ts.success) {
        console.warn('Turnstile failed:', ts.errorCodes);
        return errorResponse('Security check failed. Please refresh and try again.');
      }
    }

    if (file) {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        return errorResponse('Please upload a PDF or Word document (.pdf, .doc, .docx).');
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return errorResponse('File too large. Please upload a file under 7 MB.');
      }
    }

    const validationInput: Record<string, string> = {
      name:    fields.name,
      email:   fields.email,
      phone:   fields.phone,
      service: fields.position ?? '',
      message: fields.message ?? '',
    };

    // Extras are validated with the same engine and the site's own labels, so
    // an over-long value reads "Province must be no more than 200 characters"
    // rather than being silently truncated or ignored.
    const extraSchema: ValidationSchema = {};
    const extraLabels: Record<string, string> = {};
    for (const [key, label] of Object.entries(config.extraFields ?? {})) {
      validationInput[key] = fields.extra?.[key] ?? '';
      extraSchema[key] = { maxLength: 200 };
      extraLabels[key] = label;
    }

    const { valid, errors } = validateFields(
      validationInput,
      { ...(config.validation ?? CONTACT_SCHEMA_FULL), ...extraSchema }
    );
    if (!valid) return errorResponse(describeValidationErrors(errors, { ...FIELD_LABELS, ...extraLabels }));

    const { name, email, phone, position, message } = fields;
    // Rendered in the email in the order the site declared them.
    const extras = Object.entries(config.extraFields ?? {})
      .map(([key, label]) => ({ label, value: fields.extra?.[key] ?? '' }))
      .filter((e) => e.value);
    console.log(
      `NEW CAREERS APPLICATION | ${name} | ${phone} | ${email}` +
      (position ? ` | ${position}` : '') +
      extras.map((e) => ` | ${e.value}`).join('') +
      (file ? ` | CV: ${file.name} (${Math.round(file.size / 1024)} KB)` : '')
    );

    const referenceId = `CV-${Date.now().toString(36).toUpperCase()}`;
    const siteName = config.email.siteName ?? 'Site';


    const emailPayload = {
      from:     config.email.from,
      to:       toArray(config.email.to),
      replyTo:  [email],
      bcc:      config.email.bcc ? toArray(config.email.bcc) : undefined,
      subject:  `New CV Application${position ? `: ${position}` : ''} — ${name}`,
      htmlBody: buildCareersEmailHtml({ name, phone, email, position, message, extras, siteName, hasAttachment: !!file }),
      textBody: buildCareersEmailText({ name, phone, email, position, message, extras, hasAttachment: !!file }),
    };

    if (file) {
      await sendEmailWithAttachment(config.ses, emailPayload, {
        filename:    file.name,
        contentType: file.type,
        data:        new Uint8Array(await file.arrayBuffer()),
      });
    } else {
      await sendEmail(config.ses, emailPayload);
    }

    // Best-effort, and deliberately after the email has been sent: the email
    // is the record of the application, so a dashboard outage must never turn
    // a successful submission into a failure for the applicant.
    if (config.dashboard?.url) {
      await forwardToDashboard(config.dashboard, {
        name,
        email,
        phone,
        position,
        message,
        reference_id: referenceId,
        ...(fields.extra ?? {}),
      });
    }

    const responseData: FormResponseData = { name, email, phone };
    if (position) responseData.service = position;

    return successResponse(responseData, referenceId);
  } catch (err) {
    return serverError(err);
  }
}

// ─── Request parser ────────────────────────────────────────────────────────────

type ParsedCareersSubmission = {
  fields: CareersFields;
  file: File | null;
  honeypot: string;
  turnstileToken: string;
};

async function parseCareersRequest(
  request: Request,
  extraKeys: string[] = []
): Promise<ParsedCareersSubmission> {
  const contentType = request.headers.get('content-type') ?? '';
  const raw: Record<string, string> = {};
  let file: File | null = null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    formData.forEach((value, key) => {
      if (value instanceof File && value.size > 0) {
        if (key === 'cv') file = value;
      } else if (typeof value === 'string') {
        raw[key] = sanitizeString(value);
      }
    });
  } else if (contentType.includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) raw[k] = sanitizeString(v);
  } else {
    const formData = await request.formData();
    formData.forEach((value, key) => {
      if (typeof value === 'string') raw[key] = sanitizeString(value);
    });
  }

  return {
    fields: {
      name:     raw['name']     ?? '',
      email:    raw['email']    ?? '',
      phone:    raw['phone']    ?? '',
      position: raw['position'] || raw['service'] || undefined,
      message:  raw['message']  || undefined,
      extra:    extraKeys.length
        ? Object.fromEntries(extraKeys.map((k) => [k, raw[k] ?? '']))
        : undefined,
    },
    file,
    honeypot:       raw['website'] ?? raw['honeypot'] ?? '',
    turnstileToken: raw['cf-turnstile-response'] ?? raw['turnstileToken'] ?? '',
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function toArray(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

type ExtraRow = { label: string; value: string };

/**
 * Posts the application onward to a recruitment dashboard or CRM. Every
 * failure path is swallowed after logging — see the call site for why.
 */
async function forwardToDashboard(
  config: CareersDashboardConfig,
  payload: Record<string, string | undefined>
): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.secret) headers['Authorization'] = `Bearer ${config.secret}`;

    const res = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`Dashboard forward failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn('Dashboard forward error:', err instanceof Error ? err.message : err);
  }
}

function buildCareersEmailHtml(fields: {
  name: string;
  phone: string;
  email: string;
  position?: string;
  message?: string;
  extras?: ExtraRow[];
  siteName: string;
  hasAttachment: boolean;
}): string {
  const { name, phone, email, position, message, extras, siteName, hasAttachment } = fields;

  const row = (label: string, value: string) =>
    `<tr><td style="font-weight:bold;padding-right:16px;vertical-align:top;white-space:nowrap">${label}</td><td>${value}</td></tr>`;

  const rows = [
    row('Name',  escapeHtml(name)),
    row('Phone', `<a href="tel:${escapeHtml(phone.replace(/\s/g, ''))}">${escapeHtml(phone)}</a>`),
    row('Email', `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`),
    position ? row('Position', escapeHtml(position)) : '',
    ...(extras ?? []).map((e) => row(escapeHtml(e.label), escapeHtml(e.value))),
    message  ? row('Message',  escapeHtml(message).replace(/\n/g, '<br>')) : '',
    hasAttachment ? row('CV', '<em>Attached to this email</em>') : '',
  ].filter(Boolean).join('\n  ');

  return `<h2>New CV Application — ${escapeHtml(siteName)}</h2>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px;">
  ${rows}
</table>
<p style="margin-top:16px;color:#666;font-size:13px">Reply directly to this email to contact the applicant.</p>`;
}

function buildCareersEmailText(fields: {
  name: string;
  phone: string;
  email: string;
  position?: string;
  message?: string;
  extras?: ExtraRow[];
  hasAttachment: boolean;
}): string {
  const { name, phone, email, position, message, extras, hasAttachment } = fields;

  const lines = [
    'New CV Application',
    '',
    `Name:  ${name}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    position ? `Position: ${position}` : '',
    ...(extras ?? []).map((e) => `${e.label}: ${e.value}`),
    message  ? `Message: ${message}`   : '',
    hasAttachment ? '\nCV attached.' : '',
  ].filter((line) => line !== '');

  return lines.join('\n');
}
