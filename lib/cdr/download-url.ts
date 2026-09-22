import { readOssConfig } from '../oss/config';
import { createOssClient } from '../oss/client';

/** Never redirect to stored arbitrary URLs or reuse a long-lived signature. */
export function signBundleDownloadUrl(
  bundle: { id: string; zipFileUrl: string; zipObjectKey: string | null; expiresAt: Date },
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): string {
  const objectKey = bundle.zipObjectKey;
  if (!objectKey || !/^bundles\/[A-Za-z0-9_-]+\.zip$/.test(objectKey) || objectKey !== `bundles/${bundle.id}.zip`) {
    throw new Error('Invalid CDR bundle object key');
  }
  const expires = Math.min(60, Math.floor((bundle.expiresAt.getTime() - now.getTime()) / 1_000));
  if (expires <= 0) throw new Error('CDR bundle expired');
  const cfg = readOssConfig(env);
  if (!cfg.configured) throw new Error('CDR storage unavailable');
  return createOssClient(cfg.cfg).signatureUrl(objectKey, { method: 'GET', expires });
}
