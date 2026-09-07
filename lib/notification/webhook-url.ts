const WECOM_GROUP_BOT_WEBHOOK_PATTERN =
  /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=([^&#]+)$/;

/**
 * 企业微信群机器人只允许官方发送端点，并且仅接受一个非空 key 参数。
 * 保持为无副作用纯函数，作为存量 Webhook 兼容投递前的最后一道防线。
 */
export function isValidWecomGroupBotWebhookUrl(value: string): boolean {
  const match = WECOM_GROUP_BOT_WEBHOOK_PATTERN.exec(value);
  if (!match) return false;

  try {
    const url = new URL(value);
    const entries = Array.from(url.searchParams.entries());
    const parameter = entries[0];
    const rawKey = match[1];
    if (!parameter || !rawKey) return false;
    return (
      url.protocol === 'https:' &&
      url.hostname === 'qyapi.weixin.qq.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/cgi-bin/webhook/send' &&
      url.hash === '' &&
      entries.length === 1 &&
      parameter[0] === 'key' &&
      parameter[1].trim().length > 0 &&
      rawKey.trim().length > 0
    );
  } catch {
    return false;
  }
}
