import { REQUEST_TIMEOUT_MS, TOKEN_ENDPOINTS } from './config.js';
import type { TokenPayload } from './types.js';
import { compactText, logInfo, maskSecret } from './utils.js';

interface RefreshResult {
  ok: boolean;
  endpoint: string;
  url: string;
  status: number | null;
  error?: string;
  elapsed_ms: number;
  payload?: {
    access_token: string;
    next_refresh_token: string;
  };
}

async function postForm(url: string, data: Record<string, string>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      payload = { error: text };
    }
    if (!response.ok) {
      const error = new Error(compactText(text || response.statusText));
      Object.assign(error, { status: response.status });
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function getProxyDebugContext(): string {
  const names = ['all_proxy', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY'];
  const parts = names
    .map((name) => [name, String(process.env[name] || '').trim()] as const)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}=${value}`);
  return parts.length ? parts.join(',') : 'direct';
}

function classifyTokenRefreshFailure(result: RefreshResult): string {
  const detail = String(result.error || '').trim().toLowerCase();
  if (detail.includes('invalid_grant') || detail.includes('aadsts70000')) return 'invalid_grant';
  if (detail.includes('unauthorized_client') || detail.includes('aadsts700016')) return 'unauthorized_client';
  if (detail.includes('proxy authentication required')) return 'proxy_auth_failed';
  if (detail.includes('connection refused')) return getProxyDebugContext() !== 'direct' ? 'proxy_connect_failed' : 'connection_refused';
  if (detail.includes('eof occurred in violation of protocol') || detail.includes('wrong version number')) return getProxyDebugContext() !== 'direct' ? 'proxy_tls_failed' : 'tls_failed';
  if (detail.includes('timed out') || detail.includes('timeout') || detail.includes('abort')) return 'network_timeout';
  return 'request_failed';
}

function logTokenRefreshFailureDiagnosis(result: RefreshResult): void {
  const category = classifyTokenRefreshFailure(result);
  let message = `token refresh diagnosis endpoint=${result.endpoint} category=${category}`;
  if (category.startsWith('proxy_')) message += ` proxy=${getProxyDebugContext()}`;
  else if (category === 'invalid_grant') message += ' hint=refresh_token_or_scope_invalid';
  else if (category === 'unauthorized_client') message += ' hint=client_id_not_found_or_wrong_tenant';
  logInfo(message);
}

async function tryRefreshAccessToken(endpointName: string, clientId: string, refreshToken: string): Promise<RefreshResult> {
  const endpoint = TOKEN_ENDPOINTS[endpointName];
  const requestData = {
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    ...endpoint.extraData,
  };
  const startedAt = performance.now();
  try {
    const payload = await postForm(endpoint.url, requestData);
    const accessToken = String(payload.access_token || '').trim();
    if (!accessToken) {
      return {
        ok: false,
        endpoint: endpoint.name,
        url: endpoint.url,
        status: 200,
        error: compactText(payload.error_description || payload.error || JSON.stringify(payload)),
        elapsed_ms: Math.trunc(performance.now() - startedAt),
      };
    }
    return {
      ok: true,
      endpoint: endpoint.name,
      url: endpoint.url,
      status: 200,
      elapsed_ms: Math.trunc(performance.now() - startedAt),
      payload: {
        access_token: accessToken,
        next_refresh_token: String(payload.refresh_token || '').trim(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: endpoint.name,
      url: endpoint.url,
      status: typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : null,
      error: compactText((error as Error).message || error),
      elapsed_ms: Math.trunc(performance.now() - startedAt),
    };
  }
}

export async function refreshAccessToken(clientId: string, refreshToken: string, strategyNames = ['live', 'entra-consumers-delegated', 'entra-common-delegated']): Promise<TokenPayload> {
  const selectedEndpoints = strategyNames.filter((name) => TOKEN_ENDPOINTS[name]);
  const errors: RefreshResult[] = [];
  logInfo(`token refresh start clientId=${maskSecret(clientId)} refreshToken=${maskSecret(refreshToken)} strategies=${JSON.stringify(selectedEndpoints)}`);

  for (const endpointName of selectedEndpoints) {
    const result = await tryRefreshAccessToken(endpointName, clientId, refreshToken);
    if (result.ok && result.payload) {
      logInfo(`token refresh success endpoint=${result.endpoint} elapsedMs=${result.elapsed_ms}`);
      return {
        access_token: result.payload.access_token,
        next_refresh_token: result.payload.next_refresh_token,
        token_endpoint: result.endpoint,
        token_url: result.url,
      };
    }
    errors.push(result);
    logInfo(`token refresh failed endpoint=${result.endpoint} status=${result.status} elapsedMs=${result.elapsed_ms} detail=${result.error || ''}`);
    logTokenRefreshFailureDiagnosis(result);
  }

  const details = errors.map((item) => `${item.endpoint}(${item.status}): ${item.error || ''}`).join(' | ');
  throw new Error(`Token refresh failed on all endpoints: ${details}`);
}
