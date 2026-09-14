// 推送配置：渠道与规则（SPEC §8 / P1 #2）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { WECOM_MARKDOWN_MAX_BYTES, wecomMarkdownByteLength } from '../../notification/limits';
import { formBoolean } from './shared';

const channelNameField = z
  .string()
  .trim()
  .min(1, '请填写群名（如 排产群）')
  .max(64, '群名过长（最多 64 个字符）');

const notificationChannelIdentityFields = {
  channelKey: z
    .string()
    .trim()
    .min(1, '请填写 channelKey（英文小写 / 下划线，例：scheduling_group）')
    .max(64, 'channelKey 过长')
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'channelKey 必须以小写字母开头，仅允许小写字母 / 数字 / 下划线',
    ),
  channelName: channelNameField,
};

const smartBotTransportField = z.literal('WECOM_SMART_BOT', {
  error: '仅支持 Bot ID + Secret 智能机器人，请刷新页面后重新配置',
});

export const createNotificationChannelSchema = z.object({
  ...notificationChannelIdentityFields,
  transport: smartBotTransportField,
  webhookUrl: z.never({ error: '旧版 Webhook 配置已停止维护' }).optional(),
  // Only the authenticated group callback can establish the destination.
  isActive: z.unknown().transform(() => false),
});

export type CreateNotificationChannelInput = z.infer<
  typeof createNotificationChannelSchema
>;

// 编辑场景下不让 owner 改 channelKey（key 是稳定标识，被 audit log
// 引用；改 key 等同于&ldquo;新建+删除&rdquo;）—— UI 把 key 渲染成只读。
export const updateNotificationChannelSchema = z.object({
  transport: smartBotTransportField,
  webhookUrl: z.never({ error: '旧版 Webhook 配置已停止维护' }).optional(),
  channelName: channelNameField,
  isActive: formBoolean,
});

export type UpdateNotificationChannelInput = z.infer<
  typeof updateNotificationChannelSchema
>;

// rule 编辑：eventType 由 URL path 提供且固定 enum，不在 schema 里；
// owner 只能改 messageTemplate / channelIds / isActive。
export const updateNotificationRuleSchema = z.object({
  messageTemplate: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (value.length === 0) {
        ctx.addIssue({ code: 'custom', message: '请填写消息模板' });
        return;
      }
      // One UTF-16 code unit always occupies at least one UTF-8 byte. This
      // cheap guard bounds the TextEncoder allocation for hostile form input.
      if (value.length > WECOM_MARKDOWN_MAX_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: '模板过长（企业微信单条 markdown 上限 4096 字节）',
        });
        return;
      }
      if (wecomMarkdownByteLength(value) > WECOM_MARKDOWN_MAX_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: '模板过长（企业微信单条 markdown 上限 4096 字节）',
        });
      }
    }),
  // FormData 里多选 checkbox 走 getAll('channelIds'); 这里接 string[]。
  // 允许空数组——但 isActive=true && empty 在 server action 里业务校验
  // 拒绝（schema 不能跨字段拒，留给 action 层）。
  channelIds: z.array(z.string().min(1)).default([]),
  isActive: formBoolean,
});

export type UpdateNotificationRuleInput = z.infer<
  typeof updateNotificationRuleSchema
>;
