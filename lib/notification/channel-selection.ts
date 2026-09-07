export type NotificationChannelSelectionIssue =
  | 'LEGACY_TRANSPORT'
  | 'INACTIVE'
  | 'CHANNEL_CONFIGURATION_INCOMPLETE'
  | 'SMART_BOT_CREDENTIALS_NOT_CONFIGURED'
  | 'SMART_BOT_IDENTITY_MISMATCH';

export type NotificationChannelSelectionCandidate = Readonly<{
  transport: 'WECOM_GROUP_WEBHOOK' | 'WECOM_SMART_BOT';
  webhookUrl?: string | null;
  smartBotBotDigest: string | null;
  smartBotTargetId: string | null;
  smartBotChatType: 'SINGLE' | 'GROUP' | null;
  smartBotBoundAt: Date | null;
  isActive: boolean;
}>;

export type NotificationChannelSelectionContext = Readonly<{
  smartBotCredentialsConfigured: boolean;
  configuredSmartBotDigest: string | null;
}>;

/**
 * A channel may stay referenced after it becomes unavailable, but it must not
 * be newly selected. Keeping this decision pure lets every write path and both
 * owner forms share exactly the same eligibility policy without exposing Bot
 * IDs, Secrets, webhook URLs, or raw chat IDs to the browser.
 */
export function notificationChannelSelectionIssue(
  channel: NotificationChannelSelectionCandidate,
  context: NotificationChannelSelectionContext,
): NotificationChannelSelectionIssue | null {
  if (channel.transport === 'WECOM_GROUP_WEBHOOK') {
    return 'LEGACY_TRANSPORT';
  }
  if (!channel.isActive) return 'INACTIVE';

  if (
    !context.smartBotCredentialsConfigured ||
    !context.configuredSmartBotDigest
  ) {
    return 'SMART_BOT_CREDENTIALS_NOT_CONFIGURED';
  }
  if (
    !channel.smartBotBotDigest ||
    !channel.smartBotTargetId?.trim() ||
    !channel.smartBotChatType ||
    !channel.smartBotBoundAt
  ) {
    return 'CHANNEL_CONFIGURATION_INCOMPLETE';
  }
  return channel.smartBotBotDigest === context.configuredSmartBotDigest
    ? null
    : 'SMART_BOT_IDENTITY_MISMATCH';
}

export function notificationChannelSelectionIssueMessage(
  issue: NotificationChannelSelectionIssue,
): string {
  switch (issue) {
    case 'LEGACY_TRANSPORT':
      return '旧版 Webhook 已停止配置，请迁移到智能机器人';
    case 'INACTIVE':
      return '该群已停用';
    case 'CHANNEL_CONFIGURATION_INCOMPLETE':
      return '该通知目标配置不完整';
    case 'SMART_BOT_CREDENTIALS_NOT_CONFIGURED':
      return '服务端 Bot ID 与 Secret 未完整配置';
    case 'SMART_BOT_IDENTITY_MISMATCH':
      return '绑定时 Bot ID 与当前配置不一致';
  }
}
