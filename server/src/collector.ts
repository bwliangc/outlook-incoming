import { collectGraphMessages } from './graph.js';
import { collectImapMessages } from './imap.js';
import { collectOutlookMessages } from './outlookRest.js';
import type { CollectorResult } from './types.js';
import { compactText, logInfo, redactSensitive } from './utils.js';

type Collector = (emailAddr: string, clientId: string, refreshToken: string, mailboxes: unknown[], top: number) => Promise<CollectorResult>;

export async function collectMessages(emailAddr: string, clientId: string, refreshToken: string, mailboxes: unknown[], top: number): Promise<CollectorResult> {
  const errors: string[] = [];
  const collectors: Array<[string, Collector]> = [
    ['graph', collectGraphMessages],
    ['imap', collectImapMessages],
    ['outlook', collectOutlookMessages],
  ];

  for (const [transportName, collector] of collectors) {
    try {
      logInfo(`message collection start transport=${transportName}`);
      const result = await collector(emailAddr, clientId, refreshToken, mailboxes, top);
      logInfo(`message collection success transport=${transportName} tokenEndpoint=${result.token_payload.token_endpoint || ''}`);
      return result;
    } catch (error) {
      const message = compactText(redactSensitive((error as Error).message || error), 600);
      errors.push(`${transportName}: ${message}`);
      logInfo(`message collection failed transport=${transportName} detail=${message}`);
    }
  }

  throw new Error(`Message collection failed on all transports: ${errors.join(' | ')}`);
}
