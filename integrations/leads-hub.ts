import { successResponse, errorResponse, type FormResponseData } from '../utils/error-handler.js';
import type { FormFields } from '../forms/form-handler.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** LEADS_HUB_URL / LEADS_HUB_TOKEN — both required to route here at all. */
export type LeadsHubConfig = {
  url: string;
  token: string;
};

export type LeadSubmissionContext = {
  turnstileToken?: string;
  landingPage?: string;
};

// ─── Primary entry point ───────────────────────────────────────────────────────

/**
 * Sends an already-validated, already-Turnstile-checked submission to Leads
 * Hub instead of SES. Called from handleFormSubmission (business enquiries
 * only — see the isolation note in forms/form-handler.ts) after the site's
 * own spam/validation checks pass. This function does not re-validate
 * anything, it only relays. The raw Turnstile token still rides along so
 * Leads Hub can verify it a second time server-side, matching its existing
 * API contract; that's a harmless belt-and-braces check, not a second gate
 * the visitor has to clear.
 */
export async function submitToLeadsHub(
  config: LeadsHubConfig,
  fields: FormFields,
  context: LeadSubmissionContext = {}
): Promise<Response> {
  const payload = {
    name: fields.name,
    email: fields.email,
    phone: fields.phone || undefined,
    message: fields.message || undefined,
    source: fields.service || 'contact-form',
    landing_page: context.landingPage,
    turnstile: context.turnstileToken ? { token: context.turnstileToken } : undefined,
  };

  // One key per submission: the retry below can never create a duplicate.
  const idempotencyKey = crypto.randomUUID();

  const submit = () =>
    fetch(`${config.url}/api/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${config.token}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

  let response: Response | undefined;
  try {
    response = await submit();
    if (response.status >= 500) response = await submit();
  } catch {
    try {
      response = await submit();
    } catch {
      response = undefined;
    }
  }

  if (!response) {
    return errorResponse('Could not send your message. Please try again.', 502);
  }

  if (response.ok) {
    const body = (await response.json().catch(() => null)) as { id?: number } | null;
    const data: FormResponseData = { name: fields.name, email: fields.email, phone: fields.phone };
    if (fields.service) data.service = fields.service;
    if (fields.number) data.number = fields.number;
    return successResponse(data, body?.id ? String(body.id) : '');
  }

  if (response.status === 422) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return errorResponse(body?.message ?? 'Please check your details and try again.', 422);
  }

  // 401/403/429/5xx: configuration or platform problem — log for the
  // developer, keep the visitor-facing message generic.
  console.error(`Leads Hub returned ${response.status}`);
  return errorResponse('Could not send your message. Please try again later.', 502);
}
