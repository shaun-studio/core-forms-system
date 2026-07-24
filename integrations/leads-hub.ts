import { successResponse, errorResponse, type FormResponseData } from '../utils/error-handler.js';
import type { FormFields } from '../forms/form-handler.js';
import type { TurnstileResult } from '../security/turnstile-verify.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** LEADS_HUB_URL / LEADS_HUB_TOKEN — both required to route here at all. */
export type LeadsHubConfig = {
  url: string;
  token: string;
};

export type LeadSubmissionContext = {
  turnstileToken?: string;
  /** The site's own siteverify verdict, when the site verified the token.
   *  Present ⇒ the raw token has been SPENT and must not be relayed. */
  siteVerified?: TurnstileResult;
  landingPage?: string;
};

// ─── Primary entry point ───────────────────────────────────────────────────────

/**
 * Sends an already-validated, already-Turnstile-checked submission to Leads
 * Hub instead of SES. Called from handleFormSubmission (business enquiries
 * only — see the isolation note in forms/form-handler.ts) after the site's
 * own spam/validation checks pass. This function does not re-validate
 * anything, it only relays.
 *
 * Turnstile relay (v1.2.1): siteverify tokens are SINGLE-USE. When the site
 * already verified the token (context.siteVerified), relaying the raw token
 * would make the hub's re-verification fail with `timeout-or-duplicate` and
 * record a false-negative ✗ on the lead. So the site-verified verdict is
 * relayed instead (the hub's transitional `turnstile.passed + turnstile.data`
 * contract). The raw token is only sent when the site did NOT verify it —
 * the thin-site model, where the hub performs the one and only check.
 */
export async function submitToLeadsHub(
  config: LeadsHubConfig,
  fields: FormFields,
  context: LeadSubmissionContext = {}
): Promise<Response> {
  // Leads Hub's lead schema has no location column by design (it stays
  // generic); a location, when present, rides inside the message body.
  const message = [
    fields.location ? `Location: ${fields.location}` : '',
    fields.message ?? '',
  ].filter(Boolean).join('\n\n');

  const turnstile = context.siteVerified
    ? {
        passed: context.siteVerified.success,
        data: {
          success: context.siteVerified.success,
          hostname: context.siteVerified.hostname,
          challenge_ts: context.siteVerified.challengeTs,
          action: context.siteVerified.action,
          cdata: context.siteVerified.cdata,
          error_codes: context.siteVerified.errorCodes ?? [],
        },
      }
    : context.turnstileToken
      ? { token: context.turnstileToken }
      : undefined;

  const payload = {
    name: fields.name,
    email: fields.email,
    phone: fields.phone || undefined,
    message: message || undefined,
    source: fields.service || 'contact-form',
    landing_page: context.landingPage,
    turnstile,
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
