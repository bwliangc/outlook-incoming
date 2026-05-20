import path from 'node:path';
import express from 'express';
import { collectMessages } from './collector.js';
import { FETCH_LIMIT_DEFAULT, WEB_DIR, resolveServerConfig } from './config.js';
import { selectLatestCode } from './code.js';
import { clampTop } from './utils.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logRequestFailure(label: string, error: unknown) {
  console.error(`${label}: ${error instanceof Error ? error.name : 'Error'}`);
}

const app = express();
const publicFiles = new Set(['/app.js', '/styles.css', '/mail-utils.js']);

app.use(express.json({ limit: '1mb' }));
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  next();
});

app.options('*', (_, res) => {
  res.status(204).end();
});

function readMailPayload(body: Record<string, unknown>) {
  const emailAddr = String(body.email || '').trim();
  const clientId = String(body.clientId || '').trim();
  const refreshToken = String(body.refreshToken || '').trim();
  if (!emailAddr || !clientId || !refreshToken) {
    throw new Error('Missing email/clientId/refreshToken');
  }
  const top = clampTop(body.top || FETCH_LIMIT_DEFAULT, FETCH_LIMIT_DEFAULT);
  const mailboxes = Array.isArray(body.mailboxes) ? body.mailboxes : [body.mailbox || 'INBOX'];
  return { emailAddr, clientId, refreshToken, top, mailboxes };
}

async function messagesHandler(req: express.Request, res: express.Response) {
  try {
    const { emailAddr, clientId, refreshToken, top, mailboxes } = readMailPayload(req.body || {});
    const result = await collectMessages(emailAddr, clientId, refreshToken, mailboxes, top);
    res.status(200).json({
      ok: true,
      messages: result.messages,
      mailboxResults: result.mailboxResults,
      nextRefreshToken: result.token_payload.next_refresh_token || '',
      tokenEndpoint: result.token_payload.token_endpoint || '',
      transport: result.transport || '',
    });
  } catch (error) {
    logRequestFailure('Mail request failed', error);
    res.status(500).json({ ok: false, error: errorMessage(error) });
  }
}

async function codeHandler(req: express.Request, res: express.Response) {
  try {
    const { emailAddr, clientId, refreshToken, top, mailboxes } = readMailPayload(req.body || {});
    const result = await collectMessages(emailAddr, clientId, refreshToken, mailboxes, top);
    const selected = selectLatestCode(
      result.messages,
      Array.isArray(req.body?.senderFilters) ? req.body.senderFilters : [],
      Array.isArray(req.body?.subjectFilters) ? req.body.subjectFilters : [],
      Array.isArray(req.body?.excludeCodes) ? req.body.excludeCodes : [],
      Number.parseInt(String(req.body?.filterAfterTimestamp || 0), 10) || 0,
      Array.isArray(req.body?.requiredKeywords) ? req.body.requiredKeywords : [],
      Array.isArray(req.body?.codePatterns) ? req.body.codePatterns : [],
    );
    res.status(200).json({
      ok: true,
      code: selected.code,
      message: selected.message,
      usedTimeFallback: selected.usedTimeFallback,
      nextRefreshToken: result.token_payload.next_refresh_token || '',
      tokenEndpoint: result.token_payload.token_endpoint || '',
      transport: result.transport || '',
    });
  } catch (error) {
    logRequestFailure('Mail request failed', error);
    res.status(500).json({ ok: false, error: errorMessage(error) });
  }
}

app.post(['/messages', '/api/messages'], messagesHandler);
app.post(['/code', '/api/code'], codeHandler);

app.post('*', (req, res) => {
  res.status(404).json({ ok: false, error: `Unsupported path: ${req.path}` });
});

app.get('/', (_, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.get(['/index.html', ...publicFiles], (req, res) => {
  res.sendFile(path.join(WEB_DIR, req.path.replace(/^\//, '')));
});

app.get('*', (_, res) => {
  res.status(404).send('Not found');
});

const config = resolveServerConfig();
const server = app.listen(config.port, config.host, () => {
  console.log(`Hotmail helper listening on http://${config.host}:${config.port}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
