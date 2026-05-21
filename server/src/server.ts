import path from 'node:path';
import express from 'express';
import { collectMessages } from './collector.js';
import { FETCH_LIMIT_DEFAULT, WEB_DIR, resolveServerConfig } from './config.js';
import { clampTop, redactSensitive } from './utils.js';

function errorMessage(error: unknown): string {
  return redactSensitive(error instanceof Error ? error.message : String(error));
}

function logRequestFailure(label: string, error: unknown) {
  const name = error instanceof Error ? error.name : 'Error';
  console.error(`${label}: ${redactSensitive(name)}`);
}

const RATE_LIMIT_WINDOW_MS = Math.max(1, Number.parseInt(process.env.HOTMAIL_HELPER_RATE_LIMIT_WINDOW_MS || '60000', 10));
const RATE_LIMIT_MAX = Math.max(1, Number.parseInt(process.env.HOTMAIL_HELPER_RATE_LIMIT_MAX || '30', 10));
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function getAllowedOrigins(): string[] {
  return String(process.env.HOTMAIL_HELPER_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isSameOrigin(req: express.Request, origin: string): boolean {
  try {
    const parsedOrigin = new URL(origin);
    const host = String(req.headers.host || '').toLowerCase();
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
    const requestProto = forwardedProto || req.protocol || 'http';
    return parsedOrigin.host.toLowerCase() === host && parsedOrigin.protocol.replace(':', '') === requestProto;
  } catch {
    return false;
  }
}

function corsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();
  if (!origin) {
    next();
    return;
  }
  if (isSameOrigin(req, origin) || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    next();
    return;
  }
  res.status(403).json({ ok: false, error: 'Origin is not allowed' });
}

function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ ok: false, error: 'Too many requests, please retry later' });
    return;
  }
  next();
}

const app = express();
const publicFiles = new Set(['/app.js', '/styles.css', '/mail-utils.js']);

app.use(express.json({ limit: '1mb' }));
app.use(corsMiddleware);
app.options('*', (_, res) => {
  res.status(204).end();
});
app.use(['/messages', '/api/messages'], rateLimitMiddleware);

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

app.post(['/messages', '/api/messages'], messagesHandler);

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
