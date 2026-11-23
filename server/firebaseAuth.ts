import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type express from 'express';

export interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

export interface VerifiedFirebaseAuth {
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
}

declare global {
  namespace Express {
    interface Request {
      firebaseAuth?: VerifiedFirebaseAuth;
    }
  }
}

export function getFirebaseConfig(): FirebaseAppletConfig {
  const envProjectId = process.env.FIREBASE_PROJECT_ID;
  const envApiKey = process.env.FIREBASE_API_KEY;
  const envDbId = process.env.FIREBASE_DATABASE_ID;
  if (envProjectId && envApiKey && envDbId) {
    return {
      projectId: envProjectId,
      apiKey: envApiKey,
      firestoreDatabaseId: envDbId,
    };
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(currentDir, '..', 'firebase-applet-config.json'),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return {
        projectId: raw.projectId,
        apiKey: raw.apiKey,
        firestoreDatabaseId: raw.firestoreDatabaseId || '(default)',
      };
    }
  }
  throw new Error('Firebase configuration file or environment variables not found.');
}

// Cached Google public X.509 certificates for Firebase Auth ID tokens
let cachedCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && cachedCerts.expiresAt > now) {
    return cachedCerts.certs;
  }

  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error('Failed to fetch Firebase public signing certificates.');
  }
  const certs = (await res.json()) as Record<string, string>;
  const cc = res.headers.get('cache-control') || '';
  const match = cc.match(/max-age=(\d+)/i);
  const maxAgeSec = match ? Math.max(60, Number(match[1])) : 3600;
  cachedCerts = { certs, expiresAt: now + maxAgeSec * 1000 };
  return certs;
}

function decodeBase64UrlJson<T = Record<string, unknown>>(segment: string): T {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4);
  const jsonStr = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(jsonStr) as T;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseAuth> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
  }>(payloadB64);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase token signing algorithm.');
  }

  let certs = await getGooglePublicCerts(false);
  let pem = certs[header.kid];
  if (!pem) {
    certs = await getGooglePublicCerts(true);
    pem = certs[header.kid];
  }
  if (!pem) {
    throw new Error('Unknown Firebase signing key ID.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const sigBuf = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!verifier.verify(pem, sigBuf)) {
    throw new Error('Invalid Firebase ID token signature.');
  }

  const cfg = getFirebaseConfig();
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== cfg.projectId) {
    throw new Error('Firebase token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${cfg.projectId}`) {
    throw new Error('Firebase token issuer mismatch.');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw new Error('Invalid Firebase token subject.');
  }
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired. Please refresh your session.');
  }
  if (payload.iat && payload.iat > nowSec + 300) {
    throw new Error('Firebase token issued in the future.');
  }

  return {
    uid: payload.sub,
    email: String(payload.email || ''),
    emailVerified: Boolean(payload.email_verified),
    idToken,
  };
}

export async function requireFirebaseAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Sign in with a verified RankPilot account.' });
      return;
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: 'Missing Bearer authentication token.' });
      return;
    }
    const verified = await verifyFirebaseIdToken(token);
    if (!verified.emailVerified) {
      res.status(403).json({
        error: 'Email verification is required before using protected workspace APIs.',
      });
      return;
    }
    req.firebaseAuth = verified;
    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid or expired Firebase authentication token.',
    });
  }
}

// -----------------------------------------------------------------------------
// Firestore REST Helpers (runs strictly as the authenticated Firebase user!)
// -----------------------------------------------------------------------------

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

export function toFsValue(val: unknown): FsValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { integerValue: '0' };
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFsValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFsValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFsValue(val: FsValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map((v) => fromFsValue(v));
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return undefined;
}

export function decodeFsDocument<T = Record<string, unknown>>(doc: {
  name: string;
  fields?: Record<string, FsValue>;
}): T & { id: string } {
  const id = doc.name.split('/').pop() || '';
  const out: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = fromFsValue(v);
  }
  return out as T & { id: string };
}

function getFirestoreBase() {
  const cfg = getFirebaseConfig();
  return {
    cfg,
    rootUrl: `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents`,
    docPrefix: `projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents`,
  };
}

export async function fsGetDoc<T = Record<string, unknown>>(
  idToken: string,
  collectionPath: string,
  docId: string
): Promise<(T & { id: string }) | null> {
  const { rootUrl } = getFirestoreBase();
  const res = await fetch(`${rootUrl}/${collectionPath}/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore read failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const raw = (await res.json()) as { name: string; fields?: Record<string, FsValue> };
  return decodeFsDocument<T>(raw);
}

export async function fsCreateDoc(
  idToken: string,
  collectionPath: string,
  docId: string,
  fieldsObj: Record<string, unknown>,
  serverTimeFields: Array<'createdAt' | 'updatedAt'> = ['createdAt']
): Promise<void> {
  const { rootUrl, docPrefix } = getFirestoreBase();
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(fieldsObj)) {
    if (v !== undefined) fields[k] = toFsValue(v);
  }
  const res = await fetch(`${rootUrl}:commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: `${docPrefix}/${collectionPath}/${docId}`,
            fields,
          },
          currentDocument: { exists: false },
          updateTransforms: serverTimeFields.map((fieldPath) => ({
            fieldPath,
            setToServerValue: 'REQUEST_TIME',
          })),
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore create failed (${res.status}): ${text.slice(0, 350)}`);
  }
}

export async function fsUpdateDoc(
  idToken: string,
  collectionPath: string,
  docId: string,
  fieldsObj: Record<string, unknown>,
  setUpdatedAt = true
): Promise<void> {
  const { rootUrl, docPrefix } = getFirestoreBase();
  const fields: Record<string, FsValue> = {};
  const fieldPaths: string[] = [];
  for (const [k, v] of Object.entries(fieldsObj)) {
    if (v !== undefined) {
      fields[k] = toFsValue(v);
      fieldPaths.push(k);
    }
  }
  if (setUpdatedAt && !fieldPaths.includes('updatedAt')) {
    fieldPaths.push('updatedAt');
  }

  const write: Record<string, unknown> = {
    update: {
      name: `${docPrefix}/${collectionPath}/${docId}`,
      fields,
    },
    updateMask: { fieldPaths },
    currentDocument: { exists: true },
  };
  if (setUpdatedAt) {
    write.updateTransforms = [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }];
  }

  const res = await fetch(`${rootUrl}:commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ writes: [write] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore update failed (${res.status}): ${text.slice(0, 350)}`);
  }
}

export async function fsDeleteDoc(
  idToken: string,
  collectionPath: string,
  docId: string
): Promise<void> {
  const { rootUrl } = getFirestoreBase();
  const res = await fetch(`${rootUrl}/${collectionPath}/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Firestore delete failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

export async function fsQueryByOwner<T = Record<string, unknown>>(
  idToken: string,
  collectionPath: string,
  ownerUid: string,
  limit = 100
): Promise<Array<T & { id: string }>> {
  const { rootUrl } = getFirestoreBase();
  const res = await fetch(`${rootUrl}:runQuery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collectionPath }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'ownerId' },
            op: 'EQUAL',
            value: { stringValue: ownerUid },
          },
        },
        limit,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore query failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const rows = (await res.json()) as Array<{
    document?: { name: string; fields?: Record<string, FsValue> };
  }>;
  return rows
    .filter((row): row is { document: { name: string; fields?: Record<string, FsValue> } } =>
      Boolean(row.document)
    )
    .map((row) => decodeFsDocument<T>(row.document));
}

export async function fsWriteSyncLog(
  auth: VerifiedFirebaseAuth,
  input: {
    websiteId: string;
    channel:
      | 'wordpress'
      | 'woocommerce'
      | 'gsc'
      | 'ga4'
      | 'rank_tracker'
      | 'crawler'
      | 'pagespeed'
      | 'competitors'
      | 'backlinks'
      | 'recommendations';
    action: string;
    status: 'success' | 'error' | 'warning';
    detail: string;
  }
) {
  const logId = `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await fsCreateDoc(
    auth.idToken,
    'syncLogs',
    logId,
    {
      ownerId: auth.uid,
      websiteId: input.websiteId,
      channel: input.channel,
      action: input.action.slice(0, 120),
      status: input.status,
      detail: input.detail.slice(0, 1000),
    },
    ['createdAt']
  ).catch((err) => {
    console.warn('Non-fatal sync log write error:', err instanceof Error ? err.message : err);
  });
}
