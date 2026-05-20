import { GRAPH_API_ORIGIN, REQUEST_TIMEOUT_MS } from './config.js';
import { refreshAccessToken } from './oauth.js';
import type { CollectorResult, MailboxResult, NormalizedMessage } from './types.js';
import { clampTop, htmlToText, normalizeMailboxId, normalizeMailboxLabel } from './utils.js';

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      payload = { error: text };
    }
    if (!response.ok) throw new Error(text || response.statusText);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeGraphMessage(message: Record<string, unknown>, mailbox: string): NormalizedMessage {
  const sender = message.from && typeof message.from === 'object' ? message.from as Record<string, unknown> : {};
  const emailAddress = sender.emailAddress && typeof sender.emailAddress === 'object' ? sender.emailAddress as Record<string, unknown> : {};
  const received = String(message.receivedDateTime || '').trim();
  const body = message.body && typeof message.body === 'object' ? message.body as Record<string, unknown> : {};
  const bodyContent = String(body.content || '').trim();
  const contentType = String(body.contentType || '').trim().toLowerCase();
  const bodyHtml = contentType === 'html' ? bodyContent : '';
  const bodyText = bodyHtml ? htmlToText(bodyContent) : bodyContent;
  const timestamp = received ? Date.parse(received) : 0;
  return {
    id: String(message.id || message.internetMessageId || '').trim(),
    mailbox,
    subject: String(message.subject || '').trim(),
    from: {
      emailAddress: {
        address: String(emailAddress.address || '').trim(),
        name: String(emailAddress.name || '').trim(),
      },
    },
    bodyPreview: String(message.bodyPreview || bodyText.slice(0, 500)).trim(),
    body: {
      content: bodyText,
      html: bodyHtml,
      contentType: bodyHtml ? 'html' : 'text',
    },
    receivedDateTime: received,
    receivedTimestamp: Number.isFinite(timestamp) ? timestamp : 0,
  };
}

export async function fetchGraphMessages(accessToken: string, mailbox = 'INBOX', top = 1): Promise<MailboxResult> {
  const mailboxId = normalizeMailboxId(mailbox);
  const query = new URLSearchParams({
    $top: String(clampTop(top)),
    $select: 'id,internetMessageId,subject,from,bodyPreview,body,receivedDateTime',
    $orderby: 'receivedDateTime desc',
  });
  const url = `${GRAPH_API_ORIGIN}/v1.0/me/mailFolders/${mailboxId}/messages?${query}`;
  let payload: Record<string, unknown>;
  try {
    payload = await getJson(url, {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    });
  } catch (error) {
    throw new Error(`Graph request failed: ${(error as Error).message || error}`);
  }
  const label = normalizeMailboxLabel(mailbox);
  const messages = Array.isArray(payload.value)
    ? payload.value.map((item) => normalizeGraphMessage(item as Record<string, unknown>, label))
    : [];
  return { mailbox: label, messages, count: messages.length };
}

export async function collectGraphMessages(_emailAddr: string, clientId: string, refreshToken: string, mailboxes: unknown[], top: number): Promise<CollectorResult> {
  const tokenPayload = await refreshAccessToken(clientId, refreshToken, [
    'entra-common-delegated',
    'entra-consumers-delegated',
    'entra-common-default',
  ]);
  const mailboxResults = await Promise.all((mailboxes.length ? mailboxes : ['INBOX']).map((mailbox) => fetchGraphMessages(tokenPayload.access_token, String(mailbox), top)));
  const messages = mailboxResults.flatMap((item) => item.messages).sort((a, b) => b.receivedTimestamp - a.receivedTimestamp);
  return {
    transport: 'graph',
    token_payload: tokenPayload,
    mailboxResults,
    messages,
  };
}
