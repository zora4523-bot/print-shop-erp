import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_EVENTS,
  SUPERSEDED_BEFORE_SEND_ERROR,
  TEST_EVENT_TYPE,
} from '../events';
import {
  NOTIFICATION_EVENT_LABELS,
  notificationDeliveryMessage,
  notificationEventLabel,
} from '../event-labels';

describe('notification event business labels', () => {
  it('为每个可配置事件提供业务名称', () => {
    expect(Object.keys(NOTIFICATION_EVENT_LABELS).sort()).toEqual(
      Object.values(NOTIFICATION_EVENTS).sort(),
    );
    expect(notificationEventLabel(NOTIFICATION_EVENTS.ORDER_SUBMITTED)).toBe(
      '工单已提交',
    );
  });

  it('隐藏测试哨兵值和未知原始值', () => {
    expect(notificationEventLabel(TEST_EVENT_TYPE)).toBe('测试消息');
    expect(notificationEventLabel('UNKNOWN_RAW_EVENT')).toBe('未识别事件');
  });

  it('将投递结果转为业务文案', () => {
    expect(notificationDeliveryMessage('MOCK')).toBe('测试模式');
    expect(notificationDeliveryMessage(SUPERSEDED_BEFORE_SEND_ERROR)).toBe(
      '工单状态或版本已变化，未发送',
    );
    expect(notificationDeliveryMessage('http 429')).toBe('推送频率受限');
    expect(notificationDeliveryMessage('wecom errcode=45009')).toBe(
      '企业微信拒绝发送',
    );
    expect(notificationDeliveryMessage('invalid wecom webhook url')).toBe(
      '企业微信 Webhook 地址无效',
    );
    expect(
      notificationDeliveryMessage(
        'wecom markdown content exceeds 4096 bytes',
      ),
    ).toBe('消息内容超过企业微信限制');
    expect(notificationDeliveryMessage('TimeoutError')).toBe('推送超时');
    expect(notificationDeliveryMessage('SOME_RAW_ERROR')).toBe('推送失败');
    expect(notificationDeliveryMessage(null)).toBeNull();
  });
});
