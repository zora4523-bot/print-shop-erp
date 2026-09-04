import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationMutationResult } from '@/actions/owner-notifications.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as NotificationMutationResult | null,
    pending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), actionState.pending],
  };
});

import { ChannelForm } from '../ChannelForm';
import { RuleForm } from '../RuleForm';

const action = vi.fn(async () => ({ status: 'success' as const }));

function checkboxRoots(html: string): string[] {
  return html.match(/<span[^>]*role="checkbox"[^>]*>/g) ?? [];
}

function namedInputs(html: string, name: string): string[] {
  const inputs = html.match(/<input[^>]*>/g) ?? [];
  return inputs.filter((input) => input.includes(`name="${name}"`));
}

describe('notification form checkbox contracts', () => {
  beforeEach(() => {
    actionState.current = null;
    actionState.pending = false;
  });

  it('defaults new targets to an inactive smart-bot transport until binding', () => {
    const html = renderToStaticMarkup(
      <ChannelForm mode="create" action={action} />,
    );

    expect(checkboxRoots(html)).toHaveLength(1);
    expect(html).toContain('data-slot="checkbox"');
    expect(html).toContain('aria-checked="false"');
    expect(checkboxRoots(html)[0]).toContain('data-disabled=""');
    expect(html).toContain('aria-label="启用"');
    expect(namedInputs(html, 'isActive')).toHaveLength(1);
    expect(namedInputs(html, 'isActive')[0]).not.toContain('value=');
    expect(html).toContain('name="transport"');
    expect(html).toContain(
      '<option value="WECOM_SMART_BOT" selected="">Bot ID + Secret 智能机器人</option>',
    );
    expect(html).not.toContain('name="webhookUrl"');
    expect(html).toContain('智能机器人通道会先以停用状态保存');
  });

  it('allows an already-bound smart-bot target to keep its active state', () => {
    const html = renderToStaticMarkup(
      <ChannelForm
        mode="edit"
        action={action}
        initial={{
          channelKey: 'scheduling_group',
          channelName: '排产群',
          transport: 'WECOM_SMART_BOT',
          webhookUrl: null,
          smartBotTargetMasked: '••••a1b2',
          smartBotChatType: 'GROUP',
          smartBotBoundAt: '2026-09-03T00:00:00.000Z',
          smartBotBotMatchesConfigured: true,
          isActive: true,
        }}
      />,
    );

    expect(html).toContain('value="Bot ID + Secret 智能机器人"');
    expect(html).toContain('name="transport" value="WECOM_SMART_BOT"');
    expect(html).toContain('已绑定群聊');
    expect(html).toContain('••••a1b2');
    expect(html).toContain('aria-checked="true"');
    expect(checkboxRoots(html)[0]).not.toContain('data-disabled=""');
  });

  it('keeps rule group names, values, checked state, and disabled policy', () => {
    const html = renderToStaticMarkup(
      <RuleForm
        eventType="URGENT_ORDER"
        initial={{
          messageTemplate: '工单 {orderNo}',
          channelIds: ['inactive-selected'],
          isActive: true,
        }}
        channels={[
          {
            id: 'active-channel',
            channelName: '排产群',
            isActive: true,
            selectionIssue: null,
          },
          {
            id: 'inactive-selected',
            channelName: '旧群',
            isActive: false,
            selectionIssue: 'INACTIVE',
          },
          {
            id: 'inactive-unselected',
            channelName: '停用群',
            isActive: false,
            selectionIssue: 'INACTIVE',
          },
        ]}
        payloadFields={['orderNo']}
        action={action}
      />,
    );

    expect(html).toContain('<legend class="text-sm font-medium">推送到群（多选）</legend>');
    expect(checkboxRoots(html)).toHaveLength(4);

    const channelInputs = namedInputs(html, 'channelIds');
    expect(channelInputs).toHaveLength(3);
    expect(channelInputs.some((input) => input.includes('value="active-channel"'))).toBe(true);
    expect(
      channelInputs.some(
        (input) =>
          input.includes('value="inactive-selected"') &&
          input.includes('checked=""') &&
          !input.includes('disabled=""'),
      ),
    ).toBe(true);
    expect(
      channelInputs.some(
        (input) =>
          input.includes('value="inactive-unselected"') &&
          input.includes('disabled=""'),
      ),
    ).toBe(true);
    expect(html).toContain('aria-label="启用此规则"');
    expect(namedInputs(html, 'isActive')).toHaveLength(1);
    expect(namedInputs(html, 'isActive')[0]).not.toContain('value=');
  });

  it('显示 Bot 身份不一致原因并禁止新绑，但允许保留旧绑定', () => {
    const render = (selected: boolean) =>
      renderToStaticMarkup(
        <RuleForm
          eventType="URGENT_ORDER"
          initial={{
            messageTemplate: '工单 {orderNo}',
            channelIds: selected ? ['smart-old'] : [],
            isActive: false,
          }}
          channels={[
            {
              id: 'smart-old',
              channelName: '旧机器人群',
              isActive: true,
              selectionIssue: 'SMART_BOT_IDENTITY_MISMATCH',
            },
          ]}
          payloadFields={['orderNo']}
          action={action}
        />,
      );

    const newBindingHtml = render(false);
    expect(newBindingHtml).toContain('绑定时 Bot ID 与当前配置不一致，不可新绑');
    expect(namedInputs(newBindingHtml, 'channelIds')[0]).toContain(
      'disabled=""',
    );

    const existingBindingHtml = render(true);
    expect(existingBindingHtml).toContain('请取消勾选或修复');
    expect(namedInputs(existingBindingHtml, 'channelIds')[0]).not.toContain(
      'disabled=""',
    );
  });

  it('disables every notification checkbox while a form is pending', () => {
    actionState.pending = true;

    const channelHtml = renderToStaticMarkup(
      <ChannelForm mode="create" action={action} />,
    );
    const ruleHtml = renderToStaticMarkup(
      <RuleForm
        eventType="URGENT_ORDER"
        initial={{
          messageTemplate: '工单 {orderNo}',
          channelIds: [],
          isActive: false,
        }}
        channels={[
          {
            id: 'active-channel',
            channelName: '排产群',
            isActive: true,
            selectionIssue: null,
          },
        ]}
        payloadFields={['orderNo']}
        action={action}
      />,
    );

    expect(
      checkboxRoots(channelHtml).every((root) =>
        root.includes('data-disabled=""'),
      ),
    ).toBe(true);
    expect(
      checkboxRoots(ruleHtml).every((root) =>
        root.includes('data-disabled=""'),
      ),
    ).toBe(true);
  });

  it('托管事件显示固定角色并保留 legacy binding 但不再可编辑', () => {
    const html = renderToStaticMarkup(
      <RuleForm
        eventType="ORDER_SUBMITTED"
        initial={{
          messageTemplate: '工单 {orderNo}',
          channelIds: ['legacy-channel'],
          isActive: true,
        }}
        channels={[
          {
            id: 'active-channel',
            channelName: '排产群',
            isActive: true,
            selectionIssue: null,
          },
        ]}
        payloadFields={['orderNo']}
        action={action}
      />,
    );

    expect(html).toContain('收件角色（固定）');
    expect(html).toContain('工厂确认人');
    expect(html).toContain('href="/owner/settings"');
    expect(namedInputs(html, 'channelIds')).toEqual([
      expect.stringContaining('value="legacy-channel"'),
    ]);
    expect(checkboxRoots(html)).toHaveLength(1);
  });
});
