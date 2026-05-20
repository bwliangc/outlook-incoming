import type { NormalizedMessage } from './types.js';
import { getMessageBodyContent } from './utils.js';

interface CodePattern {
  source?: unknown;
  flags?: unknown;
}

function flagsFromValue(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  let flags = '';
  if (raw.includes('i')) flags += 'i';
  if (raw.includes('m')) flags += 'm';
  if (raw.includes('s')) flags += 's';
  return flags;
}

export function extractCode(text: unknown, codePatterns: CodePattern[] = []): string {
  const source = String(text || '');
  for (const pattern of codePatterns) {
    try {
      const sourcePattern = String(pattern?.source || '').trim();
      if (!sourcePattern) continue;
      const match = new RegExp(sourcePattern, flagsFromValue(pattern.flags)).exec(source);
      if (!match) continue;
      if (match.length > 1) {
        for (const candidate of match.slice(1)) {
          if (String(candidate || '').trim()) return String(candidate || '').trim();
        }
      }
      if (String(match[0] || '').trim()) return String(match[0] || '').trim();
    } catch {
      continue;
    }
  }

  const patterns = [
    /(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/i,
    /(?:log-?in\s+code|enter\s+this\s+code)[^0-9]{0,24}(\d{6})/i,
    /code(?:\s+is|[\s:])+(\d{6})/i,
    /\b(\d{6})\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) return match[1];
  }
  return '';
}

export function selectLatestCode(
  messages: NormalizedMessage[],
  senderFilters: unknown[],
  subjectFilters: unknown[],
  excludeCodes: unknown[],
  filterAfterTimestamp: number,
  requiredKeywords: unknown[] = [],
  codePatterns: CodePattern[] = [],
): { code: string; message: NormalizedMessage | null; usedTimeFallback: boolean } {
  const senderKeywords = (senderFilters || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  const subjectKeywords = (subjectFilters || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  const requiredKeywordHints = (requiredKeywords || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  const excluded = new Set((excludeCodes || []).map((item) => String(item).trim()).filter(Boolean));

  function matchMessage(message: NormalizedMessage, applyTimeFilter: boolean) {
    const timestamp = Math.trunc(message.receivedTimestamp || 0);
    if (applyTimeFilter && filterAfterTimestamp && timestamp && timestamp < filterAfterTimestamp) return null;

    const sender = String(message.from?.emailAddress?.address || '').toLowerCase();
    const subject = String(message.subject || '');
    const preview = String(message.bodyPreview || '');
    const combined = [sender, subject.toLowerCase(), preview.toLowerCase()].join(' ');
    let code = extractCode([subject, preview, sender].join(' '), codePatterns);
    if (!code) {
      const bodyContent = getMessageBodyContent(message);
      if (bodyContent) code = extractCode([subject, bodyContent, sender].join(' '), codePatterns);
    }
    if (!code || excluded.has(code)) return null;

    const senderOk = senderKeywords.length > 0 && senderKeywords.some((keyword) => combined.includes(keyword));
    const subjectOk = subjectKeywords.length > 0 && subjectKeywords.some((keyword) => combined.includes(keyword));
    const keywordOk = requiredKeywordHints.length > 0 && requiredKeywordHints.some((keyword) => combined.includes(keyword));
    if ((senderKeywords.length || subjectKeywords.length || requiredKeywordHints.length) && !senderOk && !subjectOk && !keywordOk) return null;
    return { code, message };
  }

  for (const useTimeFallback of [false, true]) {
    const matched = messages
      .map((message) => matchMessage(message, !useTimeFallback))
      .filter((item): item is { code: string; message: NormalizedMessage } => Boolean(item))
      .sort((a, b) => b.message.receivedTimestamp - a.message.receivedTimestamp);
    if (matched.length) {
      return {
        code: matched[0].code,
        message: matched[0].message,
        usedTimeFallback: useTimeFallback,
      };
    }
  }
  return { code: '', message: null, usedTimeFallback: false };
}
