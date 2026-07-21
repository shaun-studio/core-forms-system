// ─── Drop into: src/pages/api/submit-careers.ts ────────────────────────────────
// Only for sites that actually have a careers page — don't stub this in
// otherwise. Requires the rest of core-forms-system copied to:
// src/lib/core-forms-system/
// Astro v6 + Cloudflare adapter (output: 'static' or 'server').
// Environment variables must be set in the Cloudflare Pages dashboard.
//
// Always SES, never Leads Hub — see careers-handler.ts for why that's a
// structural guarantee, not just this file's default configuration.

export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleCareersSubmission } from '../../lib/core-forms-system/index.js';
import { errorResponse, serverError } from '../../lib/core-forms-system/utils/error-handler.js';

type Env = Record<string, string | undefined>;

export const POST: APIRoute = async ({ request }) => {
  try {
    const e = env as unknown as Env;
    return handleCareersSubmission(
      request,
      {
        ses: {
          accessKeyId:     e.AWS_ACCESS_KEY_ID     ?? '',
          secretAccessKey: e.AWS_SECRET_ACCESS_KEY ?? '',
          region:          e.AWS_REGION            ?? '',
        },
        email: {
          from:     e.SES_FROM_EMAIL   ?? '',
          to:       e.CAREERS_TO_EMAIL ?? '',
          bcc:      e.CAREERS_BCC_EMAIL,
          siteName: e.SITE_NAME        ?? 'Site',
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
