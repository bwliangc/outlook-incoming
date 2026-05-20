import { OUTLOOK_API_ORIGIN, REQUEST_TIMEOUT_MS } from './config.js';
import { refreshAccessToken } from './oauth.js';
import type { CollectorResult, MailboxResult, NormalizedMessage } from './types.js';
import { clampTop, htmlToText, normalizeMailboxId, normalizeMailboxLabel } from './utils.js';

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(text || response.statusText);
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOutlookMessage(message: Record<string, unknown>, mailbox: string): NormalizedMessage {
  const sender = (message.From || message.from) && typeof (message.From || message.from) === 'object' ? (message.From || message.from) as Record<string, unknown> : {};
  const emailAddressSource = (sender.EmailAddress || sender.emailAddress) && typeof (sender.EmailAddress || sender.emailAddress) === 'object'
    ? (sender.EmailAddress || sender.emailAddress) as Record<string, unknown>
    : {};
  const received = String(message.ReceivedDateTime || message.receivedDateTime || '').trim();
  const body = (message.Body || message.body) && typeof (message.Body || message.body) === 'object' ? (message.Body || message.body) as Record<string, unknown> : {};
  const bodyContent = String(body.Content || body.content || '').trim();
  const contentType = String(body.ContentType || body.contentType || '').trim().toLowerCase();
  const bodyHtml = contentType === 'html' ? bodyContent : '';
  const bodyText = bodyHtml ? htmlToText(bodyContent) : bodyContent;
  const timestamp = received ? Date.parse(received) : 0;
  return {
    id: String(message.Id || message.id || '').trim(),
    mailbox,
    subject: String(message.Subject || message.subject || '').trim(),
    from: {
      emailAddress: {
        address: String(emailAddressSource.Address || emailAddressSource.address || '').trim(),
        name: String(emailAddressSource.Name || emailAddressSource.name || '').trim(),
      },
    },
    bodyPreview: String(message.BodyPreview || message.bodyPreview || bodyText.slice(0, 500)).trim(),
    body: {
      content: bodyText,
      html: bodyHtml,
      contentType: bodyHtml ? 'html' : 'text',
    },
    receivedDateTime: received,
    receivedTimestamp: Number.isFinite(timestamp) ? timestamp : 0,
  };
}

export async function fetchOutlookApiMessages(accessToken: string, mailbox = 'INBOX', top = 1): Promise<MailboxResult> {
  const mailboxId = normalizeMailboxId(mailbox);
  const query = new URLSearchParams({
    $top: String(clampTop(top)),
    $select: 'Id,Subject,From,BodyPreview,Body,ReceivedDateTime',
    $orderby: 'ReceivedDateTime desc',
  });
  const url = `${OUTLOOK_API_ORIGIN}/api/v2.0/me/mailfolders/${mailboxId}/messages?${query}`;
  let payload: Record<string, unknown>;
  try {
    payload = await getJson(url, {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    });
  } catch (error) {
    throw new Error(`Outlook API request failed: ${(error as Error).message || error}`);
  }
  const label = normalizeMailboxLabel(mailbox);
  const messages = Array.isArray(payload.value)
    ? payload.value.map((item) => normalizeOutlookMessage(item as Record<string, unknown>, label))
    : [];
  return { mailbox: label, messages, count: messages.length };
}

export async function collectOutlookMessages(_emailAddr: string, clientId: string, refreshToken: string, mailboxes: unknown[], top: number): Promise<CollectorResult> {
  const tokenPayload = await refreshAccessToken(clientId, refreshToken, [
    'entra-common-outlook',
    'entra-common-delegated',
  ]);
  const mailboxResults = await Promise.all((mailboxes.length ? mailboxes : ['INBOX']).map((mailbox) => fetchOutlookApiMessages(tokenPayload.access_token, String(mailbox), top)));
  const messages = mailboxResults.flatMap((item) => item.messages).sort((a, b) => b.receivedTimestamp - a.receivedTimestamp);
  return {
    transport: 'outlook',
    token_payload: tokenPayload,
    mailboxResults,
    messages,
  };
}
