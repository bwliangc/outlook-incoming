export function compactText(value: unknown, limit = 400): string {
  return String(value || '').replace(/\r/g, ' ').replace(/\n/g, ' ').trim().slice(0, limit);
}

export function maskSecret(value: unknown, keep = 6): string {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= keep) return '*'.repeat(raw.length);
  return `${raw.slice(0, keep)}...${raw.slice(-keep)}`;
}

export function logInfo(message: string): void {
  console.log(`[HotmailHelper] ${message}`);
}

export function htmlToText(value: unknown): string {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<\s*(?:head|style|script)\b[^>]*>[\s\S]*?<\s*\/\s*(?:head|style|script)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getMessageBodyContent(message: { body?: unknown }): string {
  const body = message.body;
  if (!body || typeof body !== 'object') return '';
  return String((body as { content?: unknown }).content || '').trim();
}

export function mailboxCandidates(mailbox: unknown): string[] {
  const normalized = String(mailbox || 'INBOX').trim().toLowerCase();
  if (['junk', 'junk email', 'junk e-mail', 'junkemail'].includes(normalized)) {
    return ['Junk', 'Junk Email', 'Junk E-Mail'];
  }
  return ['INBOX'];
}

export function normalizeMailboxLabel(mailbox: unknown): string {
  const normalized = String(mailbox || 'INBOX').trim().toLowerCase();
  if (['junk', 'junk email', 'junk e-mail', 'junkemail'].includes(normalized)) return 'Junk';
  return 'INBOX';
}

export function normalizeMailboxId(mailbox: unknown): string {
  const normalized = String(mailbox || 'INBOX').trim().toLowerCase();
  if (['junk', 'junk email', 'junk e-mail', 'junkemail'].includes(normalized)) return 'junkemail';
  return 'inbox';
}

export function toTimestampMs(rawDate: unknown): number {
  if (!rawDate) return 0;
  const timestamp = Date.parse(String(rawDate));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function toIsoString(timestampMs: number): string {
  if (!timestampMs) return '';
  return new Date(timestampMs).toISOString();
}

export function clampTop(value: unknown, fallback = 1): number {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 30));
}
