import crypto from 'node:crypto';
import { getFirebaseConfig } from './firebaseAuth.ts';

function getVaultKey(): Buffer {
  const explicit = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();
  let secretMaterial = explicit;
  if (!secretMaterial) {
    let projectId = 'rankpilot-default';
    try {
      projectId = getFirebaseConfig().projectId;
    } catch {
      // ignore
    }
    const base = process.env.GEMINI_API_KEY || 'rankpilot-dev-vault-key';
    secretMaterial = `${base}:rankpilot-aes256:${projectId}`;
  }
  return crypto.scryptSync(secretMaterial, 'rankpilot-vault-salt-v1', 32);
}

export function hasDedicatedEncryptionKey(): boolean {
  return Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY?.trim());
}

export function encryptSecrets(secrets: Record<string, string>): string {
  const key = getVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(secrets);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
  return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecrets<T = Record<string, string>>(
  payload: string
): T {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted credential payload format.');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = getVaultKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted) as T;
}
