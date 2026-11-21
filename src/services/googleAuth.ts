import { createSign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedAccount: ServiceAccount | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

export function hasGoogleCredentials(): boolean {
  if (
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY)
  ) {
    return true;
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return Boolean(
    credentialsPath &&
      existsSync(path.resolve(process.cwd(), credentialsPath))
  );
}

export function isGoogleConfigured(): boolean {
  const hasFolder = Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID);
  const hasFileIds = Boolean(
    process.env.GOOGLE_FAQ_FILE_ID ||
      process.env.GOOGLE_FAQ_DOC_ID ||
      process.env.GOOGLE_PRICE_FILE_ID ||
      process.env.GOOGLE_PRICE_DOC_ID ||
      process.env.GOOGLE_SCHEDULE_FILE_ID ||
      process.env.GOOGLE_SCHEDULE_SHEET_ID ||
      process.env.GOOGLE_SCHEDULE_DOC_ID
  );

  if (!hasFolder && !hasFileIds) return false;

  return hasGoogleCredentials() || hasFileIds;
}

async function loadServiceAccount(): Promise<ServiceAccount> {
  if (cachedAccount) return cachedAccount;

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    const raw = await readFile(
      path.resolve(process.cwd(), credentialsPath),
      'utf8'
    );
    cachedAccount = normalizeAccount(JSON.parse(raw));
    return cachedAccount;
  }

  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    cachedAccount = normalizeAccount(JSON.parse(json));
    return cachedAccount;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (email && key) {
    cachedAccount = normalizeAccount({
      client_email: email,
      private_key: key,
    });
    return cachedAccount;
  }

  throw new Error(
    'Google credentials are not configured. Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file.'
  );
}

function normalizeAccount(input: {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}): ServiceAccount {
  if (!input.client_email || !input.private_key) {
    throw new Error(
      'Invalid Google service account credentials: client_email and private_key are required.'
    );
  }
  return {
    client_email: input.client_email,
    private_key: input.private_key.replace(/\\n/g, '\n'),
    token_uri: input.token_uri || TOKEN_URI,
  };
}

function clearToken() {
  cachedToken = null;
}

export async function getGoogleAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const account = await loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: account.client_email,
    scope: SCOPES,
    aud: account.token_uri || TOKEN_URI,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload)
  )}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(account.private_key)
    .toString('base64url');
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(account.token_uri || TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google OAuth token error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  if (!data?.access_token) {
    throw new Error('Google OAuth token response does not contain access_token.');
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.token;
}

export async function googleFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const run = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  let response = await run(await getGoogleAccessToken());
  if (response.status === 401) {
    clearToken();
    response = await run(await getGoogleAccessToken());
  }
  return response;
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
