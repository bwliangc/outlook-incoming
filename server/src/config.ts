import path from 'node:path';
import { Command } from 'commander';
import type { TokenEndpoint } from './types.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 17345;
export const LIVE_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
export const ENTRA_COMMON_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const ENTRA_CONSUMERS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
export const GRAPH_API_ORIGIN = 'https://graph.microsoft.com';
export const OUTLOOK_API_ORIGIN = 'https://outlook.office.com';
export const GRAPH_SCOPES = 'offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read';
export const GRAPH_DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';
export const IMAP_HOST = 'outlook.office365.com';
export const IMAP_PORT = 993;
export const REQUEST_TIMEOUT_MS = 45_000;
export const FETCH_LIMIT_DEFAULT = 1;

export const TOKEN_ENDPOINTS: Record<string, TokenEndpoint> = {
  live: {
    name: 'live',
    url: LIVE_TOKEN_URL,
    extraData: {},
  },
  'entra-consumers-delegated': {
    name: 'entra-consumers-delegated',
    url: ENTRA_CONSUMERS_TOKEN_URL,
    extraData: {
      scope: GRAPH_SCOPES,
    },
  },
  'entra-common-delegated': {
    name: 'entra-common-delegated',
    url: ENTRA_COMMON_TOKEN_URL,
    extraData: {
      scope: GRAPH_SCOPES,
    },
  },
  'entra-common-default': {
    name: 'entra-common-default',
    url: ENTRA_COMMON_TOKEN_URL,
    extraData: {
      scope: GRAPH_DEFAULT_SCOPE,
    },
  },
  'entra-common-outlook': {
    name: 'entra-common-outlook',
    url: ENTRA_COMMON_TOKEN_URL,
    extraData: {},
  },
};

export const WEB_DIR = process.env.HOTMAIL_HELPER_WEB_DIR
  ? path.resolve(process.env.HOTMAIL_HELPER_WEB_DIR)
  : path.resolve(process.cwd(), '..', 'web');

export function normalizeServerPort(rawValue: unknown, defaultPort = DEFAULT_PORT): number {
  const candidate = rawValue === undefined || rawValue === null || String(rawValue).trim() === ''
    ? defaultPort
    : rawValue;
  const port = Number.parseInt(String(candidate).trim(), 10);
  if (!Number.isInteger(port)) {
    throw new Error(`Invalid helper port: ${rawValue}`);
  }
  if (port < 1 || port > 65535) {
    throw new Error(`Helper port out of range: ${port}`);
  }
  return port;
}

export function resolveServerConfig(argv = process.argv, environ = process.env): { host: string; port: number } {
  const program = new Command();
  program
    .description('Start the local Hotmail helper service.')
    .option('--host <host>', 'Server host. Defaults to HOTMAIL_HELPER_HOST or 127.0.0.1.', String(environ.HOTMAIL_HELPER_HOST || DEFAULT_HOST).trim() || DEFAULT_HOST)
    .option('--port <port>', 'Server port. Defaults to HOTMAIL_HELPER_PORT or 17345.', environ.HOTMAIL_HELPER_PORT);

  program.exitOverride();
  program.parse(argv, { from: 'node' });
  const options = program.opts<{ host?: string; port?: string }>();
  return {
    host: String(options.host || DEFAULT_HOST).trim() || DEFAULT_HOST,
    port: normalizeServerPort(options.port, DEFAULT_PORT),
  };
}
