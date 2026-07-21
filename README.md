# core-forms-system

Form handling for Astro + Cloudflare Pages projects: parsing, spam protection,
Turnstile verification, validation, AWS SES delivery, optional CV attachments,
and optional Leads Hub routing for business enquiries — through two function
calls.

For the full architecture, the environment variable standard, the Leads Hub
routing rules, and the distribution/versioning discipline, see `FORM_OS.md` —
this file is a quick-start pointer, not a second source of truth.

---

## Quick start

Copy the library portion into your project — every library file, not a
selection, but not the `api/` folder either (that's reference templates to
copy *from*, see below, not code that belongs inside `src/lib/`):

```
your-project/
  src/lib/core-forms-system/   ← this folder minus api/, verbatim
  src/pages/api/
    submit-form.ts             ← business enquiries (every site gets this)
    submit-careers.ts          ← careers only (only if the site has one)
```

No `npm install` step for this package itself — `aws4fetch` is its only
dependency and is already declared in `package.json`; your project's own
`npm install` picks it up as part of the copied folder.

Set environment variables in the Cloudflare Pages dashboard under
**Settings → Environment Variables**. Full list, and which are business-only
vs. careers-only, is in `FORM_OS.md`. The short version:

| Variable | Used by | Required |
|---|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | both | Yes |
| `AWS_REGION` | both | No — defaults to `us-east-1` |
| `SES_FROM_EMAIL` | both | Yes |
| `SES_TO_EMAIL` / `SES_BCC_EMAIL` | business | To / Yes, Bcc / No |
| `LEADS_HUB_URL` / `LEADS_HUB_TOKEN` | business | No — both set routes to Leads Hub, either missing falls back to SES |
| `CAREERS_TO_EMAIL` / `CAREERS_BCC_EMAIL` | careers | To / Yes, Bcc / No |
| `SITE_NAME` | both | No |
| `TURNSTILE_SECRET_KEY` / `PUBLIC_TURNSTILE_SITE_KEY` | both | No — omit to disable Turnstile |

Endpoint templates for `submit-form.ts` and `submit-careers.ts` are in
`FORM_OS.md`, under "Adding this to a new or existing site."

---

## Updating an existing client site

Different from first-time setup above — this is for a site that already has
an older copy of `core-forms-system`. Full detail and reasoning is in
`FORM_OS.md` under the same heading; short version:

1. Check whether the site's `submit-form.ts` calls `handleFormSubmission`
   (standard) or has its own bespoke send logic (needs a bigger rewrite first
   — don't assume a folder swap alone connects it to anything).
2. `cp -r src/lib/core-forms-system src/lib/core-forms-system.bak` before
   changing anything.
3. Delete and replace the whole library folder (not `api/`) — never merge
   individual files by hand, and never copy a partial selection.
4. Leave `submit-form.ts` / `submit-careers.ts` alone — they live in
   `src/pages/api/`, outside the folder you just replaced.
5. Verify Cloudflare variables in the dashboard before deploying, don't
   assume from memory — especially that `LEADS_HUB_URL`/`LEADS_HUB_TOKEN` are
   either both set or both absent, never just one.
6. Test contact/quote, Leads Hub routing (if enabled), SES fallback (if not),
   and — if this site has one — the careers attachment form, checking
   specifically that a careers submission never creates a Leads Hub record
   even when this same site's business form is Leads-Hub-connected.
7. Record the new commit hash in the site's `CLAUDE.md`.

---

## How it works

Two entry points, both from `index.ts`:

```typescript
import { handleFormSubmission } from './core-forms-system/index.js';
// Business enquiries: parse → sanitize → honeypot → Turnstile → validate →
// route to Leads Hub if configured, else send via SES → typed JSON response.

import { handleCareersSubmission } from './core-forms-system/index.js';
// Careers: identical spam/validation discipline, always SES, supports one
// optional CV attachment (PDF/DOC/DOCX, 7MB cap). Never routes to Leads Hub —
// this function has no code path there, by construction.
```

Both return the same response shape:

```json
{
  "success": true,
  "message": "Message received successfully",
  "referenceId": "REF-XXXXXXXX",
  "data": { "name": "...", "email": "...", "phone": "...", "service": "..." }
}
```

Check `data.success`, not `res.ok`. For business enquiries, `referenceId`
tells you which path was taken: `REF-...` is the local SES-path generator, a
bare number is a real Leads Hub lead ID. Careers submissions always use
`CV-...`.

---

## Advanced usage

### Custom validation schema

```typescript
import { handleFormSubmission, type FormConfig } from './core-forms-system/index.js';

const config: FormConfig = {
  ses:   { accessKeyId: '...', secretAccessKey: '...', region: 'us-east-1' },
  email: { from: 'noreply@site.com', to: 'owner@site.com', siteName: 'My Site' },
  validation: {
    name:    { required: true, maxLength: 100 },
    email:   { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Invalid email' },
    message: { required: true, minLength: 10, maxLength: 1000 },
  },
};
```

### Custom email subject

```typescript
email: {
  from: 'noreply@site.com',
  to:   'owner@site.com',
  subject: ({ name, service }) => `${service} enquiry from ${name}`,
}
```

### Multiple recipients

Comma-separate them in the Cloudflare variable (`SES_TO_EMAIL` or
`CAREERS_TO_EMAIL`) — both handlers split and trim automatically. Passing an
array directly also works if you're building `EmailConfig` in code rather than
from environment variables:

```typescript
email: {
  from: 'noreply@site.com',
  to:   ['owner@site.com', 'manager@site.com'],
  bcc:  'archive@site.com',
}
```

---

## File structure

```
core-forms-system/
  index.ts                       single import point for both pipelines
  forms/
    form-handler.ts               business enquiries — the only file that
                                   may import integrations/leads-hub.js
    careers-handler.ts            careers — SES + attachments only, zero
                                   import of integrations/ anywhere
    validation.ts                 validateFields + CONTACT_SCHEMA(_FULL)
  integrations/
    leads-hub.ts                  Leads Hub API relay, called only from
                                   forms/form-handler.ts
  email/
    ses-email-service.ts          sendEmail + sendEmailWithAttachment,
                                   shared by both handlers
  security/
    turnstile-verify.ts
  utils/
    error-handler.ts               typed JSON response helpers
    sanitize.ts                    string sanitization + HTML escaping
  FORM_OS.md                       full architecture standard — read this
```

---

## AWS SES setup

1. Verify your sender domain or address in the AWS SES console.
2. IAM user with:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ses:SendEmail", "ses:SendRawEmail"],
    "Resource": "*"
  }]
}
```

3. Generate an access key, add it to Cloudflare environment variables.
4. If the SES account is still in sandbox mode, also verify the recipient
   address.

---

## Cloudflare Turnstile setup

1. Cloudflare dashboard → Turnstile → Add widget → type **Managed**.
2. Site Key → `PUBLIC_TURNSTILE_SITE_KEY` (public).
3. Secret Key → `TURNSTILE_SECRET_KEY` (server-only).

Fully optional — omit `TURNSTILE_SECRET_KEY` and verification is skipped
silently, on both pipelines.
