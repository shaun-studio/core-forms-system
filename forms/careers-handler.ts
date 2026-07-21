// careers-handler.ts must never import anything from integrations/ — CV and
// attachment submissions always go through AWS SES directly, never Leads
// Hub, regardless of whether LEADS_HUB_URL/LEADS_HUB_TOKEN are configured
// for this site's business-enquiry form. That's enforced structurally, not
// conventionally: this file has no code path that could reach Leads Hub
// even by mistake, because it has no reference to that module at all.
// Deliberately independent of forms/form-handler.ts too, so the two
// pipelines can be read, reasoned about, and audited in isolation.

import { sanitizeString, escapeHtml } from '../utils/sanitize.js';
import { validateFields, CONTACT_SCHEMA_FULL, type ValidationSchema } from './validation.js';
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
    const { fields, file, honeypot, turnstileToken } = await parseCareersRequest(request);

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

    const { valid } = validateFields(validationInput, config.validation ?? CONTACT_SCHEMA_FULL);
    if (!valid) return errorResponse('Missing required fields');

    const { name, email, phone, position, message } = fields;
    console.log(
      `NEW CAREERS APPLICATION | ${name} | ${phone} | ${email}` +
      (position ? ` | ${position}` : '') +
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
      htmlBody: buildCareersEmailHtml({ name, phone, email, position, message, siteName, hasAttachment: !!file }),
      textBody: buildCareersEmailText({ name, phone, email, position, message, hasAttachment: !!file }),
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

async function parseCareersRequest(request: Request): Promise<ParsedCareersSubmission> {
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

function buildCareersEmailHtml(fields: {
  name: string;
  phone: string;
  email: string;
  position?: string;
  message?: string;
  siteName: string;
  hasAttachment: boolean;
}): string {
  const { name, phone, email, position, message, siteName, hasAttachment } = fields;

  const row = (label: string, value: string) =>
    `<tr><td style="font-weight:bold;padding-right:16px;vertical-align:top;white-space:nowrap">${label}</td><td>${value}</td></tr>`;

  const rows = [
    row('Name',  escapeHtml(name)),
    row('Phone', `<a href="tel:${escapeHtml(phone.replace(/\s/g, ''))}">${escapeHtml(phone)}</a>`),
    row('Email', `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`),
    position ? row('Position', escapeHtml(position)) : '',
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
  hasAttachment: boolean;
}): string {
  const { name, phone, email, position, message, hasAttachment } = fields;

  const lines = [
    'New CV Application',
    '',
    `Name:  ${name}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    position ? `Position: ${position}` : '',
    message  ? `Message: ${message}`   : '',
    hasAttachment ? '\nCV attached.' : '',
  ].filter((line) => line !== '');

  return lines.join('\n');
}
