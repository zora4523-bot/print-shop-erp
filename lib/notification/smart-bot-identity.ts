import { createHash } from 'node:crypto';

/** Pure configuration helpers shared by Web health/admin code and the worker. */
export function smartBotCredentialsConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.WECOM_SMART_BOT_ID?.trim() && env.WECOM_SMART_BOT_SECRET?.trim(),
  );
}

export function smartBotIdDigest(botId: string): string {
  const normalized = botId.trim();
  if (!normalized || normalized.length > 256) {
    throw new TypeError('invalid wecom smart bot id');
  }
  return createHash('sha256')
    .update('wecom-smart-bot-id\0', 'utf8')
    .update(normalized, 'utf8')
    .digest('hex');
}

export function configuredSmartBotIdDigest(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const botId = env.WECOM_SMART_BOT_ID?.trim();
  return botId ? smartBotIdDigest(botId) : null;
}
