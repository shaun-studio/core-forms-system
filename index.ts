// ─── Primary entry point — business enquiries (contact / quote) ────────────────
// handleFormSubmission does everything: parse → validate → route → respond.
// Routes to Leads Hub when LEADS_HUB_URL + LEADS_HUB_TOKEN are both set,
// otherwise sends via SES. This is the only entry point that can reach
// Leads Hub — see forms/form-handler.ts for the isolation rule.

export { handleFormSubmission, parseFormRequest } from './forms/form-handler.js';
export type { FormConfig, RequestContext, EmailConfig, TurnstileConfig, FormFields, ParsedSubmission } from './forms/form-handler.js';

// ─── Careers — SES + attachments only, never Leads Hub ─────────────────────────

export { handleCareersSubmission } from './forms/careers-handler.js';
export type { CareersConfig, CareersEmailConfig, CareersTurnstileConfig, CareersDashboardConfig, CareersFields, CareersRequestContext } from './forms/careers-handler.js';

// ─── Email ────────────────────────────────────────────────────────────────────

export { sendEmail, sendEmailWithAttachment, buildContactEmailHtml, buildContactEmailText } from './email/ses-email-service.js';
export type { SesConfig, EmailPayload, AttachmentPayload, ContactEmailFields } from './email/ses-email-service.js';

// ─── Leads Hub ────────────────────────────────────────────────────────────────
// Routing happens inside handleFormSubmission itself — this export exists
// for direct use/testing, not because sites need to call it themselves.

export { submitToLeadsHub } from './integrations/leads-hub.js';
export type { LeadsHubConfig, LeadSubmissionContext } from './integrations/leads-hub.js';

// ─── Security ─────────────────────────────────────────────────────────────────

export { verifyTurnstile } from './security/turnstile-verify.js';
export type { TurnstileResult } from './security/turnstile-verify.js';

// ─── Validation ───────────────────────────────────────────────────────────────

export { validateFields, describeValidationErrors, FIELD_LABELS, CONTACT_SCHEMA, CONTACT_SCHEMA_FULL } from './forms/validation.js';
export type { ValidationSchema, FieldConfig, ValidationResult } from './forms/validation.js';

// ─── Response ─────────────────────────────────────────────────────────────────

export { jsonResponse, successResponse, errorResponse, serverError } from './utils/error-handler.js';
export type { FormResponse, FormResponseData } from './utils/error-handler.js';

// ─── Utilities ────────────────────────────────────────────────────────────────

export { sanitizeString, escapeHtml, sanitizeRecord } from './utils/sanitize.js';
