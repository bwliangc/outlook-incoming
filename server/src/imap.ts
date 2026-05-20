import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { FETCH_LIMIT_DEFAULT, IMAP_HOST, IMAP_PORT, REQUEST_TIMEOUT_MS } from './config.js';
import { refreshAccessToken } from './oauth.js';
import type { CollectorResult, MailboxResult, NormalizedMessage } from './types.js';
import { clampTop, htmlToText, mailboxCandidates, normalizeMailboxLabel, toIsoString, toTimestampMs } from './utils.js';

async function openMailbox(emailAddr: string, accessToken: string): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: {
      user: emailAddr,
      accessToken,
      loginMethod: 'XOAUTH2',
    },
    socketTimeout: REQUEST_TIMEOUT_MS,
    logger: false,
  });
  await client.connect();
  return client;
}

async function selectMailbox(client: ImapFlow, mailbox: string): Promise<void> {
  for (const candidate of mailboxCandidates(mailbox)) {
    try {
      await client.mailboxOpen(candidate);
      return;
    } catch {
      continue;
    }
  }
  throw new Error(`Mailbox not found: ${mailbox}`);
}

async function normalizeImapMessage(messageId: number, rawBytes: Buffer, mailbox: string): Promise<NormalizedMessage> {
  const parsed = await simpleParser(rawBytes);
  const html = typeof parsed.html === 'string' ? parsed.html.trim() : '';
  const text = String(parsed.text || '').trim() || htmlToText(html);
  const timestampMs = toTimestampMs(parsed.date?.toUTCString() || '');
  return {
    id: String(messageId),
    mailbox,
    subject: String(parsed.subject || '').trim(),
    from: {
      emailAddress: {
        address: String(parsed.from?.value?.[0]?.address || '').trim(),
        name: String(parsed.from?.value?.[0]?.name || '').trim(),
      },
    },
    bodyPreview: text.slice(0, 500),
    body: {
      content: text,
      html,
      contentType: html ? 'html' : 'text',
    },
    receivedDateTime: toIsoString(timestampMs),
    receivedTimestamp: timestampMs,
  };
}

export async function fetchImapMessages(emailAddr: string, accessToken: string, mailbox = 'INBOX', top = FETCH_LIMIT_DEFAULT): Promise<MailboxResult> {
  let client: ImapFlow | null = null;
  const logicalMailbox = normalizeMailboxLabel(mailbox);
  try {
    client = await openMailbox(emailAddr, accessToken);
    await selectMailbox(client, mailbox);
    const ids = await client.search({ all: true });
    if (!ids || !ids.length) return { mailbox: logicalMailbox, messages: [], count: 0 };

    const selectedIds = ids.slice(-clampTop(top)).reverse();
    const messages: NormalizedMessage[] = [];
    for (const messageId of selectedIds) {
      const fetched = await client.fetchOne(messageId, { source: true });
      if (!fetched || !fetched.source) continue;
      messages.push(await normalizeImapMessage(Number(messageId), Buffer.from(fetched.source), logicalMailbox));
    }
    return { mailbox: logicalMailbox, messages, count: messages.length };
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {
        // ignore logout failure
      }
    }
  }
}

export async function fetchImapMessagesForMailboxes(emailAddr: string, accessToken: string, mailboxes: unknown[], top: number): Promise<{ mailboxResults: MailboxResult[]; messages: NormalizedMessage[] }> {
  const mailboxResults: MailboxResult[] = [];
  const messages: NormalizedMessage[] = [];
  for (const mailbox of mailboxes.length ? mailboxes : ['INBOX']) {
    const result = await fetchImapMessages(emailAddr, accessToken, String(mailbox), top);
    mailboxResults.push(result);
    messages.push(...result.messages);
  }
  messages.sort((a, b) => b.receivedTimestamp - a.receivedTimestamp);
  return { mailboxResults, messages };
}

export async function collectImapMessages(emailAddr: string, clientId: string, refreshToken: string, mailboxes: unknown[], top: number): Promise<CollectorResult> {
  const tokenPayload = await refreshAccessToken(clientId, refreshToken, [
    'live',
    'entra-consumers-delegated',
    'entra-common-delegated',
  ]);
  const result = await fetchImapMessagesForMailboxes(emailAddr, tokenPayload.access_token, mailboxes, top);
  return {
    transport: 'imap',
    token_payload: tokenPayload,
    mailboxResults: result.mailboxResults,
    messages: result.messages,
  };
}
