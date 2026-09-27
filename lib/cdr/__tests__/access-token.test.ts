import { describe, expect, it } from 'vitest';
import {
  createBundleAccessToken,
  decryptBundleDownloadUrl,
  encryptBundleDownloadUrl,
  hashBundleAccessToken,
  isBundleAccessToken,
} from '../access-token';

describe('CDR bundle access token', () => {
  it('creates a 256-bit base64url token with no predictable bundle id', () => {
    const a = createBundleAccessToken();
    const b = createBundleAccessToken();
    expect(isBundleAccessToken(a)).toBe(true);
    expect(isBundleAccessToken(b)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashBundleAccessToken(a)).toHaveLength(64);
  });

  it('rejects legacy ids and malformed tokens', () => {
    expect(isBundleAccessToken('cknotrealid000000000000000')).toBe(false);
    expect(isBundleAccessToken('A'.repeat(42))).toBe(false);
    expect(isBundleAccessToken(`${'A'.repeat(42)}!`)).toBe(false);
  });

  it('encrypts the durable admin link without storing the raw URL', () => {
    const url = 'https://erp.example.com/api/cdr/bundles/token';
    const encrypted = encryptBundleDownloadUrl(url);
    expect(encrypted).not.toContain(url);
    expect(decryptBundleDownloadUrl(encrypted)).toBe(url);
    expect(decryptBundleDownloadUrl('legacy-plain-url')).toBeNull();
  });
});
