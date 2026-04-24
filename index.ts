// ─── Primary API ──────────────────────────────────────────────────────────────
// Start here. handleFormSubmission does everything: parse, validate, send email.

export { handleFormSubmission, parseFormRequest } from './forms/form-handler.js';
export type { FormConfig, EmailConfig, TurnstileConfig, ContactFormData, ParsedSubmission } from './forms/form-handler.js';

// ─── Email ────────────────────────────────────────────────────────────────────

export { sendEmail, buildContactEmailHtml, buildContactEmailText } from './email/ses-email-service.js';
export type { SesConfig, EmailPayload, ContactEmailFields } from './email/ses-email-service.js';

// ─── Security ─────────────────────────────────────────────────────────────────

export { verifyTurnstile } from './security/turnstile-verify.js';
export type { TurnstileResult } from './security/turnstile-verify.js';

// ─── Validation ───────────────────────────────────────────────────────────────

export { validateFields, DEFAULT_CONTACT_SCHEMA } from './forms/validation.js';
export type { ValidationSchema, FieldConfig, ValidationResult } from './forms/validation.js';

// ─── Utilities ────────────────────────────────────────────────────────────────

export { jsonResponse, successResponse, errorResponse, serverError } from './utils/error-handler.js';
export type { ApiResponse } from './utils/error-handler.js';

export { sanitizeString, escapeHtml, sanitizeRecord } from './utils/sanitize.js';
