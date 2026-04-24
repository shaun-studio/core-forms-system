import { sanitizeString } from '../utils/sanitize.js';
import { validateFields, DEFAULT_CONTACT_SCHEMA, type ValidationSchema } from './validation.js';
import { verifyTurnstile } from '../security/turnstile-verify.js';
import { sendEmail, buildContactEmailHtml, buildContactEmailText, type SesConfig } from '../email/ses-email-service.js';
import { errorResponse, successResponse, serverError } from '../utils/error-handler.js';

export type ContactFormData = {
  name: string;
  phone: string;
  email: string;
  service: string;
  message: string;
};

export type EmailConfig = {
  from: string;
  to: string | string[];
  bcc?: string | string[];
  siteName?: string;
  subject?: (fields: ContactFormData) => string;
};

export type TurnstileConfig = {
  secretKey: string;
};

export type FormConfig = {
  ses: SesConfig;
  email: EmailConfig;
  turnstile?: TurnstileConfig;
  validation?: ValidationSchema;
  clientIp?: string;
};

// ─── Primary entry point ───────────────────────────────────────────────────

export async function handleFormSubmission(
  request: Request,
  config: FormConfig
): Promise<Response> {
  try {
    const { fields, honeypot, turnstileToken } = await parseFormRequest(request);

    if (honeypot) return errorResponse('Spam detected');

    if (config.turnstile) {
      const ts = await verifyTurnstile(
        config.turnstile.secretKey,
        turnstileToken,
        config.clientIp
      );
      if (!ts.success) {
        console.warn('Turnstile failed:', ts.errorCodes);
        return errorResponse('Security check failed. Please refresh and try again.');
      }
    }

    const { valid } = validateFields(fields, config.validation ?? DEFAULT_CONTACT_SCHEMA);
    if (!valid) return errorResponse('Missing required fields');

    const { name, phone, email, service, message } = fields;
    console.log(`NEW LEAD | ${service} | ${name} | ${phone} | ${email}`);

    await sendEmail(config.ses, {
      from:    config.email.from,
      to:      toArray(config.email.to),
      replyTo: [email],
      bcc:     config.email.bcc ? toArray(config.email.bcc) : undefined,
      subject: config.email.subject
        ? config.email.subject(fields)
        : `New Lead: ${service} — ${name}`,
      htmlBody: buildContactEmailHtml({ name, phone, email, service, message, siteName: config.email.siteName }),
      textBody: buildContactEmailText({ name, phone, email, service, message }),
    });

    return successResponse();
  } catch (err) {
    return serverError(err);
  }
}

// ─── Lower-level utility (advanced use only) ───────────────────────────────

export type ParsedSubmission = {
  fields: ContactFormData;
  honeypot: string;
  turnstileToken: string;
};

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
      phone:   raw['phone']   ?? '',
      email:   raw['email']   ?? '',
      service: raw['service'] ?? '',
      message: raw['message'] ?? '',
    },
    honeypot:       raw['website'] ?? raw['honeypot'] ?? '',
    turnstileToken: raw['cf-turnstile-response'] ?? raw['turnstileToken'] ?? '',
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}
