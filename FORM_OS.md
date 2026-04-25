# Form OS — Architecture Standard

All client websites in the shaun-studio ecosystem use Form OS for form handling.
This document is the single source of truth for how the system works, how it is
versioned, and how to upgrade client projects.

---

## Architecture

```
Frontend (per-project ContactForm.astro)
           ↓
  POST /api/submit-form (JSON)
           ↓
  functions/api/submit-form.ts   ← Cloudflare Pages Function
  src/pages/api/submit-form.ts   ← Astro SSR route (hybrid output only)
           ↓
  @shaun-studio/core-forms-system  ← shared backend engine
           ↓
  AWS SES + Cloudflare Turnstile
```

---

## Components

### Backend — `@shaun-studio/core-forms-system`

**Path:** `/shaun-studio/core-forms-system`  
**Package name:** `@shaun-studio/core-forms-system`  
**Current version:** `1.0.0`

The single shared backend. Handles:
- Request parsing (JSON + FormData)
- Input sanitisation
- Honeypot spam rejection
- Cloudflare Turnstile verification (optional)
- Field validation
- AWS SES email dispatch
- Typed JSON responses with `referenceId`

**Rule: this package is NEVER copied into a client project. Always referenced via `file:`.**

### Frontend — `universal-form-kit-astro`

**Path:** `/shaun-studio/universal-form-kit-astro`  
**Status:** `private: true` — template only, not publishable

The frontend kit provides the reference implementation of:
- `ContactForm.astro` — form UI with honeypot + submit logic
- `ThankYouDetails.astro` — sessionStorage reader
- `src/lib/form-client.ts` — `submitContactForm()`, `getSubmissionData()`, `clearSubmissionData()`

**Rule: frontend files ARE copied per project and styled to match each site's design.
Logic (form-client.ts) must not diverge. CSS and layout may be fully customised.**

---

## Client Project Standard

### 1 — Backend dependency (required)

Every client project `package.json` must include:

```json
"@shaun-studio/core-forms-system": "file:../../shaun-studio/core-forms-system"
```

Adjust the relative path if the project is nested differently.

### 2 — API endpoint (required)

The API route must be `POST /api/submit-form` — no exceptions.

**Static output + Cloudflare Pages Functions (preferred):**
```
functions/api/submit-form.ts  →  /api/submit-form
```

**Hybrid/SSR output + Astro API route:**
```
src/pages/api/submit-form.ts  →  /api/submit-form
```

### 3 — Correct `handleFormSubmission` call signature

```typescript
// CORRECT — clientIp is the third argument (RequestContext)
return handleFormSubmission(
  request,
  { ses, email, turnstile },
  { clientIp: request.headers.get('CF-Connecting-IP') ?? undefined }
);

// WRONG — clientIp inside the config object (old API, now removed)
return handleFormSubmission(request, { ses, email, turnstile, clientIp });
```

### 4 — Environment variables (required)

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION          (optional, defaults to us-east-1)
SES_TO_EMAIL
SITE_FROM_EMAIL
SES_BCC_EMAIL       (optional)
SITE_NAME           (optional)
TURNSTILE_SECRET_KEY (optional — omit to disable Turnstile)
```

### 5 — Frontend response contract

On success, the backend returns:

```json
{
  "success": true,
  "message": "Message sent successfully.",
  "referenceId": "REF-XXXXXXXX",
  "data": { "name": "...", "email": "...", "phone": "...", "service": "...", "number": "..." }
}
```

Client code must check `data.success` (not `data.ok`, not `res.ok`).

### 6 — sessionStorage key (required)

All projects use the key `ufk_submission` with this shape:

```typescript
{
  name:    string;
  email:   string;
  phone:   string;
  service?: string;
  ref:     string;   // referenceId from backend
}
```

### 7 — Thank-you redirect (required)

On successful submission, always redirect to `/thank-you`.  
The `/thank-you` page reads from `ufk_submission`, displays the data, then clears it.

---

## Registered Client Projects

| Project | Backend method | API route | /thank-you |
|---|---|---|---|
| luxury-living-design | CF Pages Function | `/api/submit-form` ✓ | ✓ |
| pawnanycar | CF Pages Function | `/api/submit-form` ✓ | ✓ |
| signature-vault | CF Pages Function | `/api/submit-form` ✓ | ✓ |
| levels | Astro SSR route | `/api/submit-form` ✓ | ✓ |
| alley-cat-metals | CF Pages Function | `/api/submit-form` ✓ | ✓ |

---

## Versioning Strategy

`core-forms-system` uses **semantic versioning**. The current version is `1.0.0`.

| Change type | Version bump | Action required in client projects |
|---|---|---|
| Bug fix, security patch | PATCH `1.0.x` | `npm install` in each project — no code changes |
| New optional feature or field | MINOR `1.x.0` | `npm install` — review release notes for opt-in |
| Breaking API change | MAJOR `x.0.0` | Migrate each project before deploying |

### How to tag a release

```bash
# In core-forms-system:
# 1. Update version in package.json
# 2. Update CHANGELOG.md
# 3. Commit and tag:
git add package.json CHANGELOG.md FORM_OS.md
git commit -m "chore: release v1.0.1"
git tag v1.0.1
git push && git push --tags
```

### How to upgrade a client project

```bash
# Client projects use file: references, so no npm publish is needed.
# After updating core-forms-system source:

cd clients-projects/<project-name>
npm install          # re-links the file: reference
npm run build        # verify nothing broke
```

Projects do NOT auto-update. The `file:` reference resolves at `npm install` time.
Running `npm install` in a client project picks up the latest source from
`core-forms-system`. **Always run `npm run build` after upgrading** to confirm
no breaking changes were introduced.

### Preventing silent upgrades

Because `file:` references resolve at install time, a project only gets new
backend code when someone explicitly runs `npm install`. To lock a project to a
known-good state, record the `core-forms-system` commit hash in the project's
`CLAUDE.md` or deployment notes, e.g.:

```
Form OS backend pinned to: core-forms-system @ abc1234 (v1.0.0, 2026-04-25)
```

---

## Adding a New Client Project

1. Create the Astro project under `clients-projects/<project>`.
2. Add to `package.json`:
   ```json
   "@shaun-studio/core-forms-system": "file:../../shaun-studio/core-forms-system"
   ```
3. Copy from `universal-form-kit-astro`:
   - `src/lib/form-client.ts`
   - `src/components/ContactForm.astro` (customise styling)
   - `src/components/ThankYouDetails.astro` (customise styling)
4. Create `functions/api/submit-form.ts` using the template below.
5. Create `src/pages/thank-you.astro`.
6. Set environment variables in Cloudflare Pages dashboard.

### `functions/api/submit-form.ts` template

```typescript
import { handleFormSubmission } from '@shaun-studio/core-forms-system';
import { errorResponse } from '@shaun-studio/core-forms-system/utils/error-handler';

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

interface CloudflareContext { request: Request; env: Env; }

export async function onRequestPost({ request, env }: CloudflareContext): Promise<Response> {
  return handleFormSubmission(
    request,
    {
      ses: {
        accessKeyId:     env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        region:          env.AWS_REGION,
      },
      email: {
        from:     env.SITE_FROM_EMAIL,
        to:       env.SES_TO_EMAIL,
        bcc:      env.SES_BCC_EMAIL,
        siteName: env.SITE_NAME ?? 'My Site',
      },
      turnstile: env.TURNSTILE_SECRET_KEY
        ? { secretKey: env.TURNSTILE_SECRET_KEY }
        : undefined,
    },
    { clientIp: request.headers.get('CF-Connecting-IP') ?? undefined }
  );
}

export async function onRequest(context: CloudflareContext): Promise<Response> {
  if (context.request.method !== 'POST') return errorResponse('Method not allowed', 405);
  return onRequestPost(context);
}
```

---

## What NOT to do

- Do not copy `core-forms-system` source files into a client project.
- Do not create a custom SES implementation (`@aws-sdk/client-ses`, inline `aws4fetch` email logic).
- Do not use a different API endpoint (`/api/contact`, `/api/submit`, etc.).
- Do not check `json.ok` or `res.ok` for success — check `json.success`.
- Do not use `sessionStorage` keys other than `ufk_submission`.
- Do not redirect to `/thankyou` — always `/thank-you`.
