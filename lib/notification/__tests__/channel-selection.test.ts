import { describe, expect, it } from 'vitest';
import {
  notificationChannelSelectionIssue,
  notificationChannelSelectionIssueMessage,
  type NotificationChannelSelectionCandidate,
} from '../channel-selection';

const currentBotDigest = 'a'.repeat(64);
const configured = {
  smartBotCredentialsConfigured: true,
  configuredSmartBotDigest: currentBotDigest,
};

function smartBot(
  overrides: Partial<NotificationChannelSelectionCandidate> = {},
): NotificationChannelSelectionCandidate {
  return {
    transport: 'WECOM_SMART_BOT',
    webhookUrl: null,
    smartBotBotDigest: currentBotDigest,
    smartBotTargetId: 'group-1',
    smartBotChatType: 'GROUP',
    smartBotBoundAt: new Date('2026-09-04T00:00:00.000Z'),
    isActive: true,
    ...overrides,
  };
}

describe('notificationChannelSelectionIssue', () => {
  it('rejects even a complete active legacy webhook, accepting only a correctly bound smart bot', () => {
    expect(
      notificationChannelSelectionIssue(
        {
          transport: 'WECOM_GROUP_WEBHOOK',
          webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=placeholder',
          smartBotBotDigest: null,
          smartBotTargetId: null,
          smartBotChatType: null,
          smartBotBoundAt: null,
          isActive: true,
        },
        configured,
      ),
    ).toBe('LEGACY_TRANSPORT');
    expect(notificationChannelSelectionIssue(smartBot(), configured)).toBeNull();
  });

  it('rejects inactive, incomplete, missing-credential, and Bot-ID-mismatched targets', () => {
    expect(
      notificationChannelSelectionIssue(
        smartBot({ isActive: false }),
        configured,
      ),
    ).toBe('INACTIVE');
    expect(
      notificationChannelSelectionIssue(
        smartBot({ smartBotTargetId: null }),
        configured,
      ),
    ).toBe('CHANNEL_CONFIGURATION_INCOMPLETE');
    expect(
      notificationChannelSelectionIssue(smartBot(), {
        smartBotCredentialsConfigured: false,
        configuredSmartBotDigest: null,
      }),
    ).toBe('SMART_BOT_CREDENTIALS_NOT_CONFIGURED');
    expect(
      notificationChannelSelectionIssue(
        smartBot({ smartBotBotDigest: 'b'.repeat(64) }),
        configured,
      ),
    ).toBe('SMART_BOT_IDENTITY_MISMATCH');
  });

  it('provides operator-safe UI copy without destination identifiers', () => {
    expect(
      notificationChannelSelectionIssueMessage(
        'SMART_BOT_IDENTITY_MISMATCH',
      ),
    ).toBe('机器人账号已变更，请新建通知目标');
  });
});
