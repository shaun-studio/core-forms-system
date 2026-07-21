import { AwsClient } from 'aws4fetch';
import { escapeHtml } from '../utils/sanitize.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AttachmentPayload = {
  filename: string;
  contentType: string;
  data: Uint8Array;
};

export type SesConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
};

export type EmailPayload = {
  from: string;
  to: string[];
  replyTo?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  textBody: string;
};

export type ContactEmailFields = {
  name: string;
  phone: string;
  email: string;
  service?: string;
  message?: string;
  number?: string;
  siteName?: string;
};

// ─── Send ─────────────────────────────────────────────────────────────────────

export async function sendEmail(config: SesConfig, payload: EmailPayload): Promise<void> {
  const region = config.region ?? 'us-east-1';

  const aws = new AwsClient({
    accessKeyId:     config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
    service: 'ses',
  });

  const destination: { ToAddresses: string[]; BccAddresses?: string[] } = {
    ToAddresses: payload.to,
  };
  if (payload.bcc?.length) destination.BccAddresses = payload.bcc;

  const sesBody = {
    FromEmailAddress: payload.from,
    Destination:      destination,
    ...(payload.replyTo?.length ? { ReplyToAddresses: payload.replyTo } : {}),
    Content: {
      Simple: {
        Subject: { Data: payload.subject,  Charset: 'UTF-8' },
        Body: {
          Html: { Data: payload.htmlBody, Charset: 'UTF-8' },
          Text: { Data: payload.textBody, Charset: 'UTF-8' },
        },
      },
    },
  };

  const response = await aws.fetch(
    `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(sesBody),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`SES ${response.status}: ${errText}`);
  }
}

// ─── Send with attachment (raw MIME via SES v2) ───────────────────────────────

export async function sendEmailWithAttachment(
  config: SesConfig,
  payload: EmailPayload,
  attachment: AttachmentPayload
): Promise<void> {
  const region  = config.region ?? 'us-east-1';
  const mixed   = `mx${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const alt     = `al${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  const encode  = (str: string) => toBase64(new TextEncoder().encode(str));
  const chunk   = (b64: string) => b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
  const subject = `=?UTF-8?B?${encode(payload.subject)}?=`;

  let mime = '';
  mime += `From: ${payload.from}\r\n`;
  mime += `To: ${payload.to.join(', ')}\r\n`;
  if (payload.bcc?.length)     mime += `Bcc: ${payload.bcc.join(', ')}\r\n`;
  if (payload.replyTo?.length) mime += `Reply-To: ${payload.replyTo.join(', ')}\r\n`;
  mime += `Subject: ${subject}\r\n`;
  mime += 'MIME-Version: 1.0\r\n';
  mime += `Content-Type: multipart/mixed; boundary="${mixed}"\r\n`;
  mime += '\r\n';
  mime += `--${mixed}\r\n`;
  mime += `Content-Type: multipart/alternative; boundary="${alt}"\r\n`;
  mime += '\r\n';
  mime += `--${alt}\r\n`;
  mime += 'Content-Type: text/plain; charset=UTF-8\r\n';
  mime += 'Content-Transfer-Encoding: base64\r\n';
  mime += '\r\n';
  mime += chunk(encode(payload.textBody)) + '\r\n';
  mime += '\r\n';
  mime += `--${alt}\r\n`;
  mime += 'Content-Type: text/html; charset=UTF-8\r\n';
  mime += 'Content-Transfer-Encoding: base64\r\n';
  mime += '\r\n';
  mime += chunk(encode(payload.htmlBody)) + '\r\n';
  mime += '\r\n';
  mime += `--${alt}--\r\n`;
  mime += '\r\n';
  mime += `--${mixed}\r\n`;
  mime += `Content-Type: ${attachment.contentType}\r\n`;
  mime += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
  mime += 'Content-Transfer-Encoding: base64\r\n';
  mime += '\r\n';
  mime += chunk(toBase64(attachment.data)) + '\r\n';
  mime += '\r\n';
  mime += `--${mixed}--`;

  const aws = new AwsClient({
    accessKeyId:     config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
    service: 'ses',
  });

  const response = await aws.fetch(
    `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ Content: { Raw: { Data: toBase64(new TextEncoder().encode(mime)) } } }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`SES ${response.status}: ${errText}`);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ─── Template builders ────────────────────────────────────────────────────────

export function buildContactEmailHtml(fields: ContactEmailFields): string {
  const { name, phone, email, service, message, number, siteName } = fields;
  const title = siteName ? `New Lead — ${escapeHtml(siteName)}` : 'New Lead';

  const row = (label: string, value: string) =>
    `<tr><td style="font-weight:bold;padding-right:16px;vertical-align:top;white-space:nowrap">${label}</td><td>${value}</td></tr>`;

  const rows = [
    row('Name',  escapeHtml(name)),
    row('Phone', `<a href="tel:${escapeHtml(phone.replace(/\s/g, ''))}">${escapeHtml(phone)}</a>`),
    row('Email', `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`),
    service ? row('Service', escapeHtml(service)) : '',
    number  ? row('Number',  escapeHtml(number))  : '',
    message ? row('Message', escapeHtml(message).replace(/\n/g, '<br>')) : '',
  ].filter(Boolean).join('\n  ');

  return `<h2>${title}</h2>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px;">
  ${rows}
</table>`;
}

export function buildContactEmailText(fields: Omit<ContactEmailFields, 'siteName'>): string {
  const { name, phone, email, service, message, number } = fields;

  const lines = [
    'New Lead',
    '',
    `Name:  ${name}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    service ? `Service: ${service}` : '',
    number  ? `Number:  ${number}`  : '',
    message ? `Message: ${message}` : '',
  ].filter((line) => line !== '');

  return lines.join('\n');
}
