import { env } from 'cloudflare:workers';
import { sanitizeString } from '../utils/sanitize.js';
import { validateFields, describeValidationErrors, CONTACT_SCHEMA, type ValidationSchema } from './validation.js';
import { verifyTurnstile, type TurnstileResult } from '../security/turnstile-verify.js';
import { sendEmail, buildContactEmailHtml, buildContactEmailText, type SesConfig } from '../email/ses-email-service.js';
import { errorResponse, successResponse, serverError, type FormResponseData } from '../utils/error-handler.js';
import { submitToLeadsHub } from '../integrations/leads-hub.js';

// core-forms-system is the only module permitted to import integrations/
// leads-hub.js — careers-handler.ts must never gain this import. That rule
// is what keeps CV/attachment submissions structurally unable to reach
// Leads Hub, not just conventionally unlikely to.
type WorkerEnv = Record<string, string | undefined>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type FormFields = {
  name: string;
  email: string;
  phone: string;
  service?: string;
  location?: string;
  message?: string;
  number?: string;
};

export type EmailConfig = {
  from: string;
  to: string | string[];
  bcc?: string | string[];
  siteName?: string;
  subject?: (fields: FormFields) => string;
};

export type TurnstileConfig = {
  secretKey: string;
};

/** Static configuration — set once per project / environment. */
export type FormConfig = {
  ses: SesConfig;
  email: EmailConfig;
  turnstile?: TurnstileConfig;
  validation?: ValidationSchema;
};

/** Per-request context — derived from each incoming request. */
export type RequestContext = {
  clientIp?: string;
};

export type ParsedSubmission = {
  fields: FormFields;
  honeypot: string;
  turnstileToken: string;
};

// ─── Primary entry point ───────────────────────────────────────────────────────

export async function handleFormSubmission(
  request: Request,
  config: FormConfig,
  context?: RequestContext
): Promise<Response> {
  try {
    const { fields, honeypot, turnstileToken } = await parseFormRequest(request);

    if (honeypot) return errorResponse('Spam detected');

    // Kept for the Leads Hub relay: siteverify tokens are single-use, so
    // once the site verifies one, only this VERDICT may travel onward —
    // never the token itself (v1.2.1, see integrations/leads-hub.ts).
    let siteVerified: TurnstileResult | undefined;

    if (config.turnstile) {
      const ts = await verifyTurnstile(
        config.turnstile.secretKey,
        turnstileToken,
        context?.clientIp
      );
      if (!ts.success) {
        console.warn('Turnstile failed:', ts.errorCodes);
        return errorResponse('Security check failed. Please refresh and try again.');
      }
      siteVerified = ts;
    }

    const validationInput: Record<string, string> = {
      name:     fields.name,
      email:    fields.email,
      phone:    fields.phone,
      service:  fields.service  ?? '',
      location: fields.location ?? '',
      message:  fields.message  ?? '',
      number:   fields.number   ?? '',
    };

    const { valid, errors } = validateFields(validationInput, config.validation ?? CONTACT_SCHEMA);
    if (!valid) return errorResponse(describeValidationErrors(errors));

    const { name, email, phone, service, location, message, number } = fields;
    console.log(`NEW LEAD | ${name} | ${phone} | ${email}${service ? ` | ${service}` : ''}`);

    // Leads Hub routing: active only when BOTH vars are set. Either
    // missing/empty falls straight through to the existing SES path below,
    // untouched — that's the fallback, not a special case. Everything
    // above this point (honeypot, Turnstile, validation) already ran
    // identically regardless of where the email ends up; only the send
    // step itself branches.
    const workerEnv = env as unknown as WorkerEnv;
    if (workerEnv.LEADS_HUB_URL && workerEnv.LEADS_HUB_TOKEN) {
      return submitToLeadsHub(
        { url: workerEnv.LEADS_HUB_URL, token: workerEnv.LEADS_HUB_TOKEN },
        fields,
        {
          turnstileToken: turnstileToken || undefined,
          siteVerified,
          landingPage: request.headers.get('referer') ?? undefined,
        }
      );
    }

    const referenceId = generateReferenceId();

    await sendEmail(config.ses, {
      from:    config.email.from,
      to:      toArray(config.email.to),
      replyTo: [email],
      bcc:     config.email.bcc ? toArray(config.email.bcc) : undefined,
      subject: config.email.subject
        ? config.email.subject(fields)
        : `New Lead${service ? `: ${service}` : ''} — ${name}`,
      htmlBody: buildContactEmailHtml({ name, phone, email, service: service ?? '', location, message: message ?? '', number, siteName: config.email.siteName }),
      textBody: buildContactEmailText({ name, phone, email, service: service ?? '', location, message: message ?? '', number }),
    });

    const responseData: FormResponseData = { name, email, phone };
    if (service)  responseData.service  = service;
    if (location) responseData.location = location;
    if (number)   responseData.number   = number;

    return successResponse(responseData, referenceId);
  } catch (err) {
    return serverError(err);
  }
}

// ─── Request parser ────────────────────────────────────────────────────────────

export async function parseFormRequest(request: Request): Promise<ParsedSubmission> {
  const contentType = request.headers.get('content-type') ?? '';
  const raw: Record<string, string> = {};

  if (contentType.includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) raw[k] = sanitizeString(v);
  } else {
    const formData = await request.formData();
    formData.forEach((value, key) => { raw[key] = sanitizeString(value); });
  }

  return {
    fields: {
      name:    raw['name']    ?? '',
      email:   raw['email']   ?? '',
      phone:   raw['phone']   ?? '',
      service:  raw['service']  || undefined,
      location: raw['location'] || undefined,
      message:  raw['message']  || undefined,
      number:   raw['number']   || undefined,
    },
    honeypot:       raw['website'] ?? raw['honeypot'] ?? '',
    turnstileToken: raw['cf-turnstile-response'] ?? raw['turnstileToken'] ?? '',
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function generateReferenceId(): string {
  return `REF-${Date.now().toString(36).toUpperCase()}`;
}

function toArray(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
