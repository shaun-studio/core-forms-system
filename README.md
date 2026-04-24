# core-forms-system

A plug-and-play form handling system for Astro + Cloudflare Pages projects. Handles form parsing, spam protection, Cloudflare Turnstile verification, input validation, and AWS SES email delivery through a single function call.

---

## Quick Start

### 1. Copy the folder into your project

```
your-project/
  src/lib/core-forms-system/   ← paste here
  functions/
    api/
      contact.ts               ← copy from core-forms-system/api/submit-form.ts
```

### 2. Install the one dependency

```bash
npm install aws4fetch
```

### 3. Set environment variables

Set these in your Cloudflare Pages dashboard under **Settings → Environment Variables**.

| Variable | Required | Description |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | Yes | IAM access key with `ses:SendEmail` permission |
| `AWS_SECRET_ACCESS_KEY` | Yes | IAM secret key |
| `AWS_REGION` | No | AWS region — defaults to `us-east-1` |
| `SITE_FROM_EMAIL` | Yes | Verified SES sender address (e.g. `noreply@yoursite.com`) |
| `SES_TO_EMAIL` | Yes | Where leads are delivered (e.g. `owner@yoursite.com`) |
| `SES_BCC_EMAIL` | No | Optional BCC address |
| `SITE_NAME` | No | Business name — appears in email subject line |
| `TURNSTILE_SECRET_KEY` | No | Cloudflare Turnstile secret — omit to disable CAPTCHA |
| `PUBLIC_TURNSTILE_SITE_KEY` | No | Turnstile site key for the frontend widget |

### 4. Drop the Cloudflare Pages Function

Copy `api/submit-form.ts` to `functions/api/contact.ts` in your project. It reads all config from environment variables automatically — no edits needed.

### 5. Add the form to your frontend

```astro
---
const siteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '';
---

<form id="contact-form">
  <input type="text"  name="website" style="display:none" tabindex="-1" autocomplete="off" /><!-- honeypot -->
  <input type="text"  name="name"    required placeholder="Your name" />
  <input type="tel"   name="phone"   required placeholder="Phone number" />
  <input type="email" name="email"   required placeholder="Email address" />
  <input type="text"  name="service" required placeholder="Service needed" />
  <textarea           name="message" required placeholder="Your message"></textarea>

  {siteKey && <div class="cf-turnstile" data-sitekey={siteKey}></div>}

  <button type="submit">Send</button>
</form>

{siteKey && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>}

<script>
  document.getElementById('contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));

    const res  = await fetch('/api/contact', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:           data.name,
        phone:          data.phone,
        email:          data.email,
        service:        data.service,
        message:        data.message,
        honeypot:       data.website,
        turnstileToken: data['cf-turnstile-response'] ?? '',
      }),
    });

    const result = await res.json();
    if (result.ok) window.location.href = '/thank-you';
    else alert(result.error ?? 'Something went wrong.');
  });
</script>
```

---

## How It Works

Everything runs through one function:

```typescript
import { handleFormSubmission } from './core-forms-system/index.js';

const response = await handleFormSubmission(request, config);
```

Internally it runs these steps in order:

1. Parse the request body (JSON or FormData)
2. Sanitize all inputs
3. Check honeypot — silent reject if filled
4. Verify Turnstile token (if `config.turnstile` is set)
5. Validate all required fields
6. Send email via AWS SES
7. Return a typed JSON `Response`

---

## Advanced Usage

### Custom validation schema

Replace the default schema (name, phone, email, service, message) with your own field definitions:

```typescript
import { handleFormSubmission, type FormConfig } from './core-forms-system/index.js';

const config: FormConfig = {
  ses:   { accessKeyId: '...', secretAccessKey: '...', region: 'eu-west-1' },
  email: { from: 'noreply@site.com', to: 'owner@site.com', siteName: 'My Site' },
  validation: {
    name:    { required: true, maxLength: 100 },
    email:   { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Invalid email' },
    message: { required: true, minLength: 10, maxLength: 1000 },
  },
};

const response = await handleFormSubmission(request, config);
```

### Custom email subject

Pass a function that receives the validated fields and returns a subject string:

```typescript
const config: FormConfig = {
  // ...
  email: {
    from: 'noreply@site.com',
    to:   'owner@site.com',
    subject: ({ name, service }) => `[Pawn Any Car] ${service} enquiry from ${name}`,
  },
};
```

### Multiple recipients

```typescript
email: {
  from: 'noreply@site.com',
  to:   ['owner@site.com', 'manager@site.com'],
  bcc:  'archive@site.com',
}
```

---

## File Structure

```
core-forms-system/
  index.ts                     ← single import point
  api/
    submit-form.ts             ← Cloudflare Pages Function (copy to functions/api/)
  email/
    ses-email-service.ts       ← AWS SES sender + email template builders
  forms/
    form-handler.ts            ← handleFormSubmission — the primary entry point
    validation.ts              ← validateFields + DEFAULT_CONTACT_SCHEMA
  security/
    turnstile-verify.ts        ← Cloudflare Turnstile token verification
  utils/
    error-handler.ts           ← typed JSON response helpers
    sanitize.ts                ← string sanitization + HTML escaping
```

---

## AWS SES Setup

1. Open the **AWS SES console** and verify your sender domain or email address.
2. Create an IAM user with this policy:

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

3. Generate an access key for that IAM user and add it to Cloudflare environment variables.
4. If your SES account is still in sandbox mode, also verify the recipient email address.

---

## Cloudflare Turnstile Setup

1. Open the **Cloudflare dashboard → Turnstile → Add widget**.
2. Select widget type **Managed** (auto-detects bots with no user interaction).
3. Copy the **Site Key** → set as `PUBLIC_TURNSTILE_SITE_KEY` (public, safe to expose).
4. Copy the **Secret Key** → set as `TURNSTILE_SECRET_KEY` (keep private, server-only).

Turnstile is fully optional. If `TURNSTILE_SECRET_KEY` is not set, the verification step is skipped silently.
