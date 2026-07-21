// ─── Primary entry point ───────────────────────────────────────────────────────
// handleFormSubmission does everything: parse → validate → send email → respond.

export { handleFormSubmission, parseFormRequest } from './forms/form-handler.js';
export type { FormConfig, RequestContext, EmailConfig, TurnstileConfig, FormFields, ParsedSubmission } from './forms/form-handler.js';

// ─── Email ────────────────────────────────────────────────────────────────────

export { sendEmail, sendEmailWithAttachment, buildContactEmailHtml, buildContactEmailText } from './email/ses-email-service.js';
export type { SesConfig, EmailPayload, AttachmentPayload, ContactEmailFields } from './email/ses-email-service.js';

// ─── Security ─────────────────────────────────────────────────────────────────

export { verifyTurnstile } from './security/turnstile-verify.js';
export type { TurnstileResult } from './security/turnstile-verify.js';

// ─── Validation ───────────────────────────────────────────────────────────────

export { validateFields, CONTACT_SCHEMA, CONTACT_SCHEMA_FULL } from './forms/validation.js';
export type { ValidationSchema, FieldConfig, ValidationResult } from './forms/validation.js';

// ─── Response ─────────────────────────────────────────────────────────────────

export { jsonResponse, successResponse, errorResponse, serverError } from './utils/error-handler.js';
export type { FormResponse, FormResponseData } from './utils/error-handler.js';

// ─── Utilities ────────────────────────────────────────────────────────────────

export { sanitizeString, escapeHtml, sanitizeRecord } from './utils/sanitize.js';
