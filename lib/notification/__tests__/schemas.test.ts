import { describe, it, expect } from 'vitest';
import {
  createNotificationChannelSchema,
  updateNotificationChannelSchema,
  updateNotificationRuleSchema,
} from '@/lib/auth/schemas';

describe('createNotificationChannelSchema', () => {
  const valid = {
    channelKey: 'scheduling_group',
    channelName: '排产群',
    webhookUrl:
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd-1234',
    isActive: true,
  };

  it('合法输入 → ok', () => {
    expect(createNotificationChannelSchema.safeParse(valid).success).toBe(true);
  });

  it('channelKey 含大写 → 拒', () => {
    const r = createNotificationChannelSchema.safeParse({
      ...valid,
      channelKey: 'Scheduling',
    });
    expect(r.success).toBe(false);
  });

  it('channelKey 数字开头 → 拒', () => {
    const r = createNotificationChannelSchema.safeParse({
      ...valid,
      channelKey: '1group',
    });
    expect(r.success).toBe(false);
  });

  it('channelKey 含连字符 → 拒（仅下划线）', () => {
    const r = createNotificationChannelSchema.safeParse({
      ...valid,
      channelKey: 'sales-group',
    });
    expect(r.success).toBe(false);
  });

  it('webhookUrl 非 qyapi.weixin.qq.com → 拒', () => {
    const r = createNotificationChannelSchema.safeParse({
      ...valid,
      webhookUrl: 'https://attacker.example.com/cgi-bin/webhook/send?key=x',
    });
    expect(r.success).toBe(false);
  });

  it('webhookUrl HTTP（非 https）→ 拒', () => {
    const r = createNotificationChannelSchema.safeParse({
      ...valid,
      webhookUrl: 'http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
    });
    expect(r.success).toBe(false);
  });

  it.each([
    ['缺少 key', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send'],
    ['key 为空', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key='],
    [
      '额外 query',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x&debug=1',
    ],
    [
      '重复 key',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x&key=y',
    ],
    [
      'fragment',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x#fragment',
    ],
    [
      '用户信息',
      'https://user@qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
    ],
    [
      '错误路径',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send/?key=x',
    ],
  ])('webhookUrl %s → 拒', (_case, webhookUrl) => {
    const r = createNotificationChannelSchema.safeParse({
      ...valid,
      webhookUrl,
    });
    expect(r.success).toBe(false);
  });

  it('channelName 空 → 拒', () => {
    const r = createNotificationChannelSchema.safeParse({
      ...valid,
      channelName: '   ',
    });
    expect(r.success).toBe(false);
  });

  it('isActive 缺省 (FormData "on" / "true") → 接受', () => {
    expect(
      createNotificationChannelSchema.safeParse({
        ...valid,
        isActive: 'on',
      }).success,
    ).toBe(true);
    expect(
      createNotificationChannelSchema.safeParse({
        ...valid,
        isActive: 'true',
      }).success,
    ).toBe(true);
  });

  it('isActive 未传 → 视为 false（formBoolean 行为）', () => {
    const r = createNotificationChannelSchema.safeParse({
      ...valid,
      isActive: undefined,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.isActive).toBe(false);
  });
});

describe('updateNotificationChannelSchema', () => {
  it('合法 → ok（不含 channelKey 字段）', () => {
    const r = updateNotificationChannelSchema.safeParse({
      channelName: '排产群',
      webhookUrl:
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
      isActive: true,
    });
    expect(r.success).toBe(true);
  });

  it('与新建共用严格 Webhook URL 校验', () => {
    const r = updateNotificationChannelSchema.safeParse({
      channelName: '排产群',
      webhookUrl:
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x&debug=1',
      isActive: true,
    });
    expect(r.success).toBe(false);
  });
});

describe('updateNotificationRuleSchema', () => {
  it('合法 → ok', () => {
    const r = updateNotificationRuleSchema.safeParse({
      messageTemplate: '工单 {orderNo} 提交',
      channelIds: ['c1', 'c2'],
      isActive: true,
    });
    expect(r.success).toBe(true);
  });

  it('channelIds 缺省 → []（不挂在 schema 层；跨字段 isActive=true && empty 由 action 层挡）', () => {
    const r = updateNotificationRuleSchema.safeParse({
      messageTemplate: 'x',
      isActive: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.channelIds).toEqual([]);
  });

  it('messageTemplate 空 → 拒', () => {
    const r = updateNotificationRuleSchema.safeParse({
      messageTemplate: '   ',
      channelIds: [],
      isActive: false,
    });
    expect(r.success).toBe(false);
  });

  it('messageTemplate 恰好 4096 个 ASCII 字节 → ok', () => {
    const r = updateNotificationRuleSchema.safeParse({
      messageTemplate: 'a'.repeat(4096),
      channelIds: [],
      isActive: false,
    });
    expect(r.success).toBe(true);
  });

  it('messageTemplate 超过 4096 个 UTF-8 字节 → 拒', () => {
    const ascii = updateNotificationRuleSchema.safeParse({
      messageTemplate: 'a'.repeat(4097),
      channelIds: [],
      isActive: false,
    });
    const chinese = updateNotificationRuleSchema.safeParse({
      // 1366 个中文字符是 4098 个 UTF-8 字节。
      messageTemplate: '中'.repeat(1366),
      channelIds: [],
      isActive: false,
    });

    expect(ascii.success).toBe(false);
    expect(chinese.success).toBe(false);
  });

  it('messageTemplate 4095 个中文 UTF-8 字节 → ok', () => {
    const r = updateNotificationRuleSchema.safeParse({
      messageTemplate: '中'.repeat(1365),
      channelIds: [],
      isActive: false,
    });
    expect(r.success).toBe(true);
  });

  it('channelIds 含空 string → 拒（每个元素至少 1 字符）', () => {
    const r = updateNotificationRuleSchema.safeParse({
      messageTemplate: 'x',
      channelIds: ['c1', ''],
      isActive: false,
    });
    expect(r.success).toBe(false);
  });
});
