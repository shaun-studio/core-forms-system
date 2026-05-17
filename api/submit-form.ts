// ─── Drop into: src/pages/api/submit-form.ts ──────────────────────────────────
// Requires the rest of core-forms-system copied to: src/lib/core-forms-system/
// Astro v6 + Cloudflare adapter (output: 'static' or 'server').
// Environment variables must be set in the Cloudflare Pages dashboard.

export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleFormSubmission } from '../../lib/core-forms-system/index.js';
import { errorResponse, serverError } from '../../lib/core-forms-system/utils/error-handler.js';

type Env = Record<string, string | undefined>;

export const POST: APIRoute = async ({ request }) => {
  try {
    const e = env as unknown as Env;
    return handleFormSubmission(
      request,
      {
        ses: {
          accessKeyId:     e.AWS_ACCESS_KEY_ID     ?? '',
          secretAccessKey: e.AWS_SECRET_ACCESS_KEY ?? '',
          region:          e.AWS_REGION            ?? '',
        },
        email: {
          from:     e.SES_FROM_EMAIL ?? e.SITE_FROM_EMAIL ?? '',
          to:       e.SES_TO_EMAIL   ?? '',
          bcc:      e.SES_BCC_EMAIL,
          siteName: e.SITE_NAME      ?? 'Site',
        },
        turnstile: e.TURNSTILE_SECRET_KEY
          ? { secretKey: e.TURNSTILE_SECRET_KEY }
          : undefined,
      },
      {
        clientIp: request.headers.get('CF-Connecting-IP') ?? undefined,
      }
    );
  } catch (err) {
    return serverError(err);
  }
};

export const ALL: APIRoute = () => errorResponse('Method not allowed', 405);
