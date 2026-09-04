import { describe, expect, it, vi } from 'vitest';
import {
  WECOM_SMART_BOT_SEND_INTERVAL_MS,
  digestSmartBotTarget,
  waitForSmartBotSendSlot,
} from '../smart-bot-throttle';

describe('smart-bot conversation throttle', () => {
  it('uses a stable opaque digest separated by bot, chat type, and target', () => {
    const digest = digestSmartBotTarget('bot-1', 'GROUP', 'chat-1');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('bot-1');
    expect(digest).not.toContain('chat-1');
    expect(digest).not.toBe(digestSmartBotTarget('bot-2', 'GROUP', 'chat-1'));
    expect(digest).not.toBe(digestSmartBotTarget('bot-1', 'SINGLE', 'chat-1'));
    expect(WECOM_SMART_BOT_SEND_INTERVAL_MS).toBeGreaterThanOrEqual(3_600);
  });

  it('waits for the shared database slot without consuming a stale permit', async () => {
    const repository = {
      tryReserve: vi
        .fn()
        .mockResolvedValueOnce({ acquired: false, retryAfterMs: 123 })
        .mockResolvedValueOnce({ acquired: true }),
    };
    const delay = vi.fn(async () => undefined);

    await waitForSmartBotSendSlot('bot-1', 'GROUP', 'chat-1', {
      repository,
      delay,
    });

    expect(repository.tryReserve).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledExactlyOnceWith(123, undefined);
  });

  it('rejects empty raw identifiers before touching the database', async () => {
    const repository = { tryReserve: vi.fn() };
    await expect(
      waitForSmartBotSendSlot('bot-1', 'GROUP', '', { repository }),
    ).rejects.toThrow('invalid wecom smart bot target');
    expect(repository.tryReserve).not.toHaveBeenCalled();
  });
});
