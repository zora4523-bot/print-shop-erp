import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), create: vi.fn(), update: vi.fn(), revalidate: vi.fn(), redirect: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.authorize }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/notification/admin', () => ({
  createChannel: mocks.create,
  updateChannel: mocks.update,
  ChannelTransportMismatchError: class extends Error {},
  UnboundSmartBotChannelError: class extends Error {},
  SmartBotIdentityMismatchError: class extends Error {},
}));
vi.mock('@/lib/notification/resolve', () => ({}));
vi.mock('@/lib/notification/test-channel', () => ({}));

import { ChannelTransportMismatchError } from '@/lib/notification/admin';
import { createChannelAction, updateChannelAction } from '../owner-notifications';

function form(transport: string | null = 'WECOM_SMART_BOT', webhook = false) {
  const data = new FormData();
  data.set('channelKey', 'test_smart');
  data.set('channelName', '测试群');
  data.set('isActive', 'on');
  if (transport !== null) data.set('transport', transport);
  if (webhook) data.set('webhookUrl', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=placeholder');
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ id: 'admin' });
  mocks.redirect.mockImplementation(() => { throw new Error('REDIRECT'); });
});

describe('notification configuration actions', () => {
  it.each([null, 'WECOM_GROUP_WEBHOOK'])('rejects missing or legacy transport: %s', async (transport) => {
    expect(await createChannelAction(null, form(transport))).toMatchObject({ status: 'invalid', fieldErrors: { transport: expect.any(Array) } });
    expect(await updateChannelAction('legacy', null, form(transport))).toMatchObject({ status: 'invalid', fieldErrors: { transport: expect.any(Array) } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('rejects legacy webhook fields even if the caller claims smart-bot transport', async () => {
    const created = await createChannelAction(null, form('WECOM_SMART_BOT', true));
    const updated = await updateChannelAction('legacy', null, form('WECOM_SMART_BOT', true));
    for (const result of [created, updated]) {
      expect(result).toMatchObject({ status: 'invalid', fieldErrors: { webhookUrl: expect.any(Array) } });
      expect(JSON.stringify(result)).not.toContain('placeholder');
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('forces new smart targets inactive and only invalidates the configuration page', async () => {
    await expect(createChannelAction(null, form())).rejects.toThrow('REDIRECT');
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith('notification:config');
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ channelKey: 'test_smart', channelName: '测试群', transport: 'WECOM_SMART_BOT', isActive: false });
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith('/owner/notifications');
  });

  it('reports the domain guard when a stored legacy target is disguised as smart', async () => {
    mocks.update.mockRejectedValue(new ChannelTransportMismatchError());
    expect(await updateChannelAction('legacy', null, form())).toMatchObject({ status: 'error', message: expect.stringContaining('旧版目标') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('does not touch configuration when authorization fails', async () => {
    mocks.authorize.mockRejectedValue(new Error('forbidden'));
    await expect(createChannelAction(null, form())).rejects.toThrow('forbidden');
    await expect(updateChannelAction('smart', null, form())).rejects.toThrow('forbidden');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
