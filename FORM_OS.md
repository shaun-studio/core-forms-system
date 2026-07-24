# Form OS — Architecture Standard

All client websites in the shaun-studio ecosystem use Form OS for form handling.
This document is the single source of truth for how the system works and how to
adopt or upgrade a client project. It replaces an earlier version of this document
that described a `file:` package-reference distribution model — that model never
actually worked on Cloudflare Pages (its remote build servers only ever clone the
one repository being deployed; there is no sibling folder on disk to reference),
which is the real reason the fleet quietly settled on copy-paste instead. This
document now describes what actually works.

---

## Architecture

Two independent pipelines, sharing utilities but never sharing the send step:

```
Business enquiry (contact / quote)          Careers (CV applications)
            |                                          |
            v                                          v
  src/pages/api/submit-form.ts           src/pages/api/submit-careers.ts
            |                                          |
            v                                          v
     forms/form-handler.ts                  forms/careers-handler.ts
            |                                          |
  honeypot / Turnstile / validation        honeypot / Turnstile / validation
            |                                (identical checks, separate code)
            v                                          |
  LEADS_HUB_URL + LEADS_HUB_TOKEN                       v
            |                                    AWS SES only
      ┌─────┴─────┐                        (with attachment if a CV is present)
   present      missing
      |            |
      v            v
  Leads Hub     AWS SES
```

`careers-handler.ts` contains no import of `integrations/leads-hub.ts` and no
reference to `LEADS_HUB_URL`/`LEADS_HUB_TOKEN` anywhere in the file. This is a
structural guarantee, not a behavioral convention — a CV application cannot reach
Leads Hub by way of a misconfigured variable or a misplaced conditional, because
the code path to get there does not exist in that file. Verify it yourself at any
time with `grep -n leads-hub forms/careers-handler.ts` — it should only ever match
the comment explaining why there's nothing to find.

---

## Distribution model

**The library portion of `core-forms-system` is copied, verbatim, into every
client project at `src/lib/core-forms-system/`.** Not selectively — every
library file, every site, even sites that will never have a careers form. This
is deliberate:

- No npm package, no private registry.
- No `file:` reference (confirmed non-functional on Cloudflare Pages' build
  servers — see above).
- No git submodule.
- No separate "with attachments" folder or package. There is one master.

"Library portion" means everything except `api/` — `forms/`, `careers-handler.ts`
included, `integrations/`, `email/`, `security/`, `utils/`, `index.ts`. The
`api/` folder is reference templates to copy *from*, not code that belongs
inside `src/lib/`. Its own relative imports (`../../lib/core-forms-system/...`)
are only correct once moved to `src/pages/api/`, and if it's left sitting
inside `src/lib/core-forms-system/api/` instead, both Astro's type checker and
any editor tooling will report it as broken — because at that location, it is.
This isn't a new rule invented for this rewrite: every real fleet site checked
during this audit already worked this way, copying `forms/`, `email/`,
`security/`, `utils/`, and `index.ts` but never an `api/` subfolder. This
document is just the first time it's been written down.

Unused code is not a problem worth solving here. A site with no careers form
simply never creates a `submit-careers.ts` that imports `careers-handler.ts` —
the file sits in `src/lib/` unused and harmless. What *is* a problem is selective
copying — deciding per site which files to include based on that site's current
needs is exactly how this system ended up with 15+ silently drifted variants
across 92 sites before this rewrite. Copy the whole folder, every time, with no
exceptions, and drift becomes something you can check for with a hash comparison
instead of something you discover eight months later during an unrelated audit.

### Version tracking

Since there's no package manager to pin a version, traceability is manual and
mandatory. Every site that copies this folder must record, in that site's own
`CLAUDE.md` or deployment notes, the commit hash and date it was copied from:

```
core-forms-system copied from: <commit-hash> (2026-07-21)
```

This is what makes a future "which sites are on which version" audit take
minutes: hash each site's `src/lib/core-forms-system/` and compare against the
commit history here, rather than reading every file on every site by hand.

---

## Components

### `forms/form-handler.ts` — business enquiries

`handleFormSubmission(request, config, context?)`. Handles contact and quote
forms. Runs honeypot check, optional Turnstile verification, and field
validation identically regardless of outcome, then checks `LEADS_HUB_URL` and
`LEADS_HUB_TOKEN` (read directly from the Cloudflare Workers `env` binding —
nothing to pass in from the call site). Both present routes to Leads Hub via
`integrations/leads-hub.ts`; either missing or empty falls through to the
existing AWS SES send, unchanged. This is the only file in the package permitted
to import `integrations/leads-hub.ts`.

Recognised fields: `name`, `email`, `phone` (required by the default
`CONTACT_SCHEMA`), plus optional `service`, `location`, `message`, `number`.
`location` (added v1.2.0 for the locksmith fleet's "Where are you located?"
field) is optional by default — sites that require it pass a custom schema from
their endpoint: `validation: { ...CONTACT_SCHEMA, location: { required: true,
maxLength: 200 } }`. In SES emails it renders as its own row; in Leads Hub
submissions it is prepended to the message body (`Location: …`), because the
hub's lead schema stays deliberately generic.

Turnstile relay (fixed v1.2.1): Cloudflare siteverify tokens are single-use.
When the site itself verifies the token (`TURNSTILE_SECRET_KEY` set), the
Leads Hub relay sends the site's verdict (`turnstile.passed` +
`turnstile.data`, the hub's transitional contract) instead of the spent
token. v1.2.0 relayed the raw token, so the hub's re-verification failed
with `timeout-or-duplicate` and every relayed lead was stored with a
false-negative `turnstile_passed = false` (first observed on nexofusion
lead #40, 2026-07-24). The raw token is still sent when the site did not
verify it — the thin-site model where the hub performs the only check.

### `forms/careers-handler.ts` — CV applications

`handleCareersSubmission(request, config, context?)`. Same spam/validation
discipline as the business path, always sends via SES, supports an optional
`cv` file field (PDF/DOC/DOCX, 7MB cap). Never imports anything from
`integrations/`.

### `integrations/leads-hub.ts`

`submitToLeadsHub(config, fields, context?)` — builds the Leads Hub payload,
sends with an idempotency key, retries once on a 5xx or network failure, shapes
the response using the same `successResponse`/`errorResponse` helpers as the
SES path. Only ever called from `forms/form-handler.ts`.

### `email/ses-email-service.ts`

`sendEmail` (both handlers) and `sendEmailWithAttachment` (careers only) — raw
MIME construction, base64 encoding, sent via SES v2's raw-send endpoint using
`aws4fetch` for SigV4 signing. One shared module; both pipelines use it so a fix
to SES signing or MIME encoding reaches both paths at once.

### `security/turnstile-verify.ts`, `forms/validation.ts`, `utils/`

Unchanged by this rewrite. Shared identically by both handlers.

---

## Environment variables

Business enquiries (contact / quote):

```
SES_FROM_EMAIL          verified SES sender identity
SES_TO_EMAIL            recipient(s) — comma-separated for multiple
SES_BCC_EMAIL           optional
```

Leads Hub (business enquiries only — both required to activate):

```
LEADS_HUB_URL           e.g. https://leads.virtualmart.co.za
LEADS_HUB_TOKEN         the website's lh_... token from the Leads Hub panel
```

Careers — completely separate, never read by the business path or by Leads Hub:

```
SES_FROM_EMAIL          reused from above; add CAREERS_FROM_EMAIL only if a
                        site genuinely needs applications to appear to come
                        from a different sender — don't provision it by default
CAREERS_TO_EMAIL        comma-separated for multiple
CAREERS_BCC_EMAIL       optional
```

Shared:

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION                   optional, defaults to us-east-1
SITE_NAME                    optional, appears in email subject/heading
TURNSTILE_SECRET_KEY         optional — omit to disable Turnstile verification
PUBLIC_TURNSTILE_SITE_KEY    optional — frontend widget key
```

`SITE_FROM_EMAIL` is retired. Some fleet sites still use it from an earlier
version of this standard — migrate them to `SES_FROM_EMAIL` when next touched,
it is not being kept as a permanent alias.

---

## Response contract

Both `handleFormSubmission` and `handleCareersSubmission` return the same shape:

```json
{
  "success": true,
  "message": "Message received successfully",
  "referenceId": "REF-XXXXXXXX",
  "data": { "name": "...", "email": "...", "phone": "...", "service": "..." }
}
```

Check `data.success` — not `data.ok`, not `res.ok`. `referenceId` format tells
you which path a business-enquiry submission took without inspecting anything
else: `REF-...` means it went through SES (the local fallback generator);  a
bare number (e.g. `"11"`) means Leads Hub accepted it and that's its real lead
ID. Careers submissions always use the `CV-...` format regardless of whether an
attachment was included.

---

## Adding this to a new or existing site

1. Copy the library portion of `core-forms-system` into `src/lib/core-forms-system/`
   — everything except `api/` (that's reference templates, not library code —
   see "Distribution model" above).
2. Create `src/pages/api/submit-form.ts` for business enquiries (template
   below). Every site gets this one.
3. If the site has a careers page, also create
   `src/pages/api/submit-careers.ts` (template below). Most sites won't need
   this — skip it, don't stub it.
4. Set the environment variables above in the Cloudflare Pages dashboard.
5. Record the commit hash you copied from in the site's `CLAUDE.md`.
6. Test both paths locally with real credentials before deploying: a business
   enquiry with `LEADS_HUB_URL`/`LEADS_HUB_TOKEN` unset (confirms SES fallback),
   and — if applicable — a careers submission with an attachment, confirming it
   never appears in Leads Hub even if that site's business form is Leads-Hub-
   connected.

### `src/pages/api/submit-form.ts`

```typescript
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
          from:     e.SES_FROM_EMAIL ?? '',
          to:       e.SES_TO_EMAIL   ?? '',
          bcc:      e.SES_BCC_EMAIL,
          siteName: e.SITE_NAME      ?? 'Site',
        },
        turnstile: e.TURNSTILE_SECRET_KEY ? { secretKey: e.TURNSTILE_SECRET_KEY } : undefined,
      },
      { clientIp: request.headers.get('CF-Connecting-IP') ?? undefined }
    );
  } catch (err) {
    return serverError(err);
  }
};

export const ALL: APIRoute = () => errorResponse('Method not allowed', 405);
```

### `src/pages/api/submit-careers.ts`

```typescript
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
        turnstile: e.TURNSTILE_SECRET_KEY ? { secretKey: e.TURNSTILE_SECRET_KEY } : undefined,
      },
      { clientIp: request.headers.get('CF-Connecting-IP') ?? undefined }
    );
  } catch (err) {
    return serverError(err);
  }
};

export const ALL: APIRoute = () => errorResponse('Method not allowed', 405);
```

---

## Updating an existing client site

This is a different procedure from "Adding this to a new or existing site"
above — that section is for a site that has never had `core-forms-system`.
This one is for refreshing a site that already has an older copy onto the
current master.

### 1. Confirm current site architecture before replacing files

Check what the site's own `src/pages/api/submit-form.ts` actually calls
before touching anything:

- If it calls `handleFormSubmission` from `../../lib/core-forms-system/index.js`
  — the standard pattern — the steps below apply directly.
- If it has its own bespoke `sendEmail()` call instead (a small number of
  fleet sites still do — this predates the shared library being adopted
  everywhere), stop here. Replacing `src/lib/core-forms-system` alone will
  not connect that site to anything; its endpoint needs rewriting to the
  standard pattern first, as its own separate task.
- Note whether the site has a real careers form today (a `/careers` page
  posting to its own endpoint). That determines step 5 below.

### 2. Backup existing `src/lib/core-forms-system`

Don't overwrite in place with nothing to fall back on:

```bash
cp -r src/lib/core-forms-system src/lib/core-forms-system.bak
```

Delete the backup once the site is verified working on the new version. Don't
commit it.

### 3. Replace the entire folder with the new master version

Delete `src/lib/core-forms-system` and copy in the library portion of the
current master — every file, not a selection, and not the master's `api/`
folder (reference templates only, see "Distribution model" above). Copying
the whole thing, always, is what keeps this auditable; picking and choosing
which files a given site "needs" is exactly how the fleet drifted into 15+
silently divergent versions before this rewrite.

### 4. Do not manually merge individual files

If the site has made a local edit inside `src/lib/core-forms-system` (it
shouldn't, but check), resolve that by deciding whether the change belongs
upstream in the master repo or was a one-off that's no longer needed —  don't
hand-merge it into the new copy and don't carry forward a silent local fork.
A site-specific need belongs in that site's own `submit-form.ts`/
`submit-careers.ts`, never inside the library folder itself.

### 5. Keep site-specific API routes

`submit-form.ts` and, only if the site actually has a careers form,
`submit-careers.ts` are not part of what gets replaced — they live in
`src/pages/api/`, outside the folder you just swapped, and stay as they are
unless step 1 found them using the old bespoke pattern. Don't create
`submit-careers.ts` for a site that has no careers form.

### 6. Verify Cloudflare variables before deployment

Confirm in the Cloudflare Pages dashboard, don't assume from memory:
`SES_FROM_EMAIL`, `SES_TO_EMAIL`, `SES_BCC_EMAIL` are set. `LEADS_HUB_URL` and
`LEADS_HUB_TOKEN` are either both set (site is going live on Leads Hub) or
both absent (site stays on SES) — never just one. `CAREERS_TO_EMAIL` and
`CAREERS_BCC_EMAIL` are set if and only if this site has a careers form.

### 7. Test

All of these locally, with real credentials, before deploying — not after:

- Contact/quote form — a real submission, confirm it succeeds.
- Leads Hub routing, if `LEADS_HUB_URL`/`LEADS_HUB_TOKEN` are set — confirm
  the response `referenceId` is a bare number (a real Leads Hub lead id), not
  `REF-...`, and confirm the lead actually exists in Leads Hub.
- SES fallback, if Leads Hub variables are not set for this site — confirm
  the response `referenceId` is `REF-...` and the email actually arrives.
- Careers form with a real attachment, if applicable — confirm it sends via
  SES (`referenceId` starting `CV-...`) and, critically, confirm no
  corresponding record appears in Leads Hub even if this same site's business
  form is Leads-Hub-connected. Don't skip this check because the business
  form test passed — they're different code paths.

### 8. Record the master commit hash in `CLAUDE.md`

Same practice as first-time adoption — write the commit hash and date into
the site's own `CLAUDE.md` or deployment notes:

```
core-forms-system updated to: <commit-hash> (<date>)
```

This is what makes the next audit take minutes instead of days.

---

## What NOT to do

- Do not add an `npm install`/package step of any kind for this system — copy
  the folder.
- Do not maintain a second copy of this folder for attachment support. There is
  one master; attachments are part of it.
- Do not add a `formType` flag to `form-handler.ts` that branches into SES vs
  Leads Hub vs careers behavior. Careers stays a separate file with zero import
  of `integrations/` — that's what makes "CVs never reach Leads Hub" a fact you
  can grep for instead of a behavior you have to trust.
- Do not use a different endpoint name (`/api/contact`, `/api/submit`, etc.) —
  `/api/submit-form` and `/api/submit-careers` only.
- Do not check `json.ok`/`res.ok` for success — check `json.success`.
- Do not selectively copy only the files a site currently needs. Copy the whole
  folder, every time.
