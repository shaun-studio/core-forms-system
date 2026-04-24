import { handleFormSubmission } from '../forms/form-handler.js';
import { errorResponse } from '../utils/error-handler.js';

// Drop this file into: functions/api/contact.ts
// All config is read from Cloudflare environment variables at runtime.

interface Env {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION?: string;
  SES_TO_EMAIL: string;
  SES_BCC_EMAIL?: string;
  SITE_FROM_EMAIL: string;
  SITE_NAME?: string;
  TURNSTILE_SECRET_KEY?: string;
}

interface CloudflareContext {
  request: Request;
  env: Env;
}

export async function onRequestPost({ request, env }: CloudflareContext): Promise<Response> {
  return handleFormSubmission(request, {
    ses: {
      accessKeyId:     env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      region:          env.AWS_REGION,
    },
    email: {
      from:     env.SITE_FROM_EMAIL,
      to:       env.SES_TO_EMAIL,
      bcc:      env.SES_BCC_EMAIL,
      siteName: env.SITE_NAME,
    },
    turnstile: env.TURNSTILE_SECRET_KEY
      ? { secretKey: env.TURNSTILE_SECRET_KEY }
      : undefined,
    clientIp: request.headers.get('CF-Connecting-IP') ?? undefined,
  });
}

export async function onRequest(context: CloudflareContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }
  return onRequestPost(context);
}
