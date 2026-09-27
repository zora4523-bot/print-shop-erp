import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function createBundleAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashBundleAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isBundleAccessToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim() || (process.env.NODE_ENV === 'production' ? '' : 'local-development-only-cdr-bundle-key');
  if (!secret) throw new Error('AUTH_SECRET is required to protect CDR download links');
  return createHash('sha256').update(`print-shop-erp:cdr-url:v1:${secret}`, 'utf8').digest();
}

export function encryptBundleDownloadUrl(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptBundleDownloadUrl(value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
