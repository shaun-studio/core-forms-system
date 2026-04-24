import { AwsClient } from 'aws4fetch';
import { escapeHtml } from '../utils/sanitize.js';

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

export type ContactEmailFields = {
  name: string;
  phone: string;
  email: string;
  service: string;
  message: string;
  siteName?: string;
};

export function buildContactEmailHtml(fields: ContactEmailFields): string {
  const { name, phone, email, service, message, siteName } = fields;
  const title = siteName ? `New Lead — ${escapeHtml(siteName)}` : 'New Lead';
  const row = (label: string, value: string) =>
    `<tr><td style="font-weight:bold;padding-right:16px;vertical-align:top">${label}</td><td>${value}</td></tr>`;

  return `
<h2>${title}</h2>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px;">
  ${row('Name',    escapeHtml(name))}
  ${row('Phone',   `<a href="tel:${escapeHtml(phone.replace(/\s/g, ''))}">${escapeHtml(phone)}</a>`)}
  ${row('Email',   `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`)}
  ${row('Service', escapeHtml(service))}
  ${row('Message', escapeHtml(message).replace(/\n/g, '<br>'))}
</table>`.trim();
}

export function buildContactEmailText(fields: Omit<ContactEmailFields, 'siteName'>): string {
  const { name, phone, email, service, message } = fields;
  return `New Lead\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\nService: ${service}\nMessage: ${message}`;
}
