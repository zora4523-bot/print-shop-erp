import { describe, expect, it, vi } from 'vitest';

describe('deployment invalid-index guard', () => {
  it('rejects every invalid index and identifies the notification correctness dependency', async () => {
    const smoke = await import('../deploy-smoke.mjs');
    const query = vi.fn().mockResolvedValue({ rows: [
      { schema_name: 'public', index_name: 'NotificationLog_deliveryKey_channelId_key' },
      { schema_name: 'archive', index_name: 'other_invalid' },
    ] });
    await expect(smoke.checkInvalidIndexes({ query })).rejects.toThrow('archive.other_invalid');
    await expect(smoke.checkInvalidIndexes({ query })).rejects.toThrow('NotificationLog_deliveryKey_channelId_key');
    expect(query.mock.calls[0]?.[0]).toMatch(/NOT\s+i\.indisvalid/);
  });
  it('accepts an empty invalid-index result without modifying the database', async () => {
    const smoke = await import('../deploy-smoke.mjs');
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(smoke.checkInvalidIndexes({ query })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0].trim()).toMatch(/^SELECT/);
  });
});
