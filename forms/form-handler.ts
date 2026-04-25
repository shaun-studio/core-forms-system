import { sanitizeString } from '../utils/sanitize.js';
import { validateFields, CONTACT_SCHEMA, type ValidationSchema } from './validation.js';
import { verifyTurnstile } from '../security/turnstile-verify.js';
import { sendEmail, buildContactEmailHtml, buildContactEmailText, type SesConfig } from '../email/ses-email-service.js';
import { errorResponse, successResponse, serverError, type FormResponseData } from '../utils/error-handler.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FormFields = {
  name: string;
  email: string;
  phone: string;
  service?: string;
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
    }

    const validationInput: Record<string, string> = {
      name:    fields.name,
      email:   fields.email,
      phone:   fields.phone,
      service: fields.service ?? '',
      message: fields.message ?? '',
      number:  fields.number  ?? '',
    };

    const { valid } = validateFields(validationInput, config.validation ?? CONTACT_SCHEMA);
    if (!valid) return errorResponse('Missing required fields');

    const { name, email, phone, service, message, number } = fields;
    console.log(`NEW LEAD | ${name} | ${phone} | ${email}${service ? ` | ${service}` : ''}`);

    const referenceId = generateReferenceId();

    await sendEmail(config.ses, {
      from:    config.email.from,
      to:      toArray(config.email.to),
      replyTo: [email],
      bcc:     config.email.bcc ? toArray(config.email.bcc) : undefined,
      subject: config.email.subject
        ? config.email.subject(fields)
        : `New Lead${service ? `: ${service}` : ''} — ${name}`,
      htmlBody: buildContactEmailHtml({ name, phone, email, service: service ?? '', message: message ?? '', number, siteName: config.email.siteName }),
      textBody: buildContactEmailText({ name, phone, email, service: service ?? '', message: message ?? '', number }),
    });

    const responseData: FormResponseData = { name, email, phone };
    if (service) responseData.service = service;
    if (number)  responseData.number  = number;

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
      service: raw['service'] || undefined,
      message: raw['message'] || undefined,
      number:  raw['number']  || undefined,
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
  return Array.isArray(value) ? value : [value];
}
