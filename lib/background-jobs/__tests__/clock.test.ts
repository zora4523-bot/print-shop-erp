import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { $queryRaw: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { databaseNow, type ClockClient } from '../clock';

const DB_NOW = new Date('2026-07-17T08:00:00.000Z');

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
});

describe('databaseNow', () => {
  it('asks the database for its own clock', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ now: DB_NOW }]);

    // toBe，不是 toEqual：返回的必须是数据库给的那一个对象本身。一旦中间
    // 有人 new Date(...) 重新包装，本进程的时钟就有机会混进来。
    await expect(databaseNow()).resolves.toBe(DB_NOW);

    const sql = (
      dbMock.$queryRaw.mock.calls[0]![0] as TemplateStringsArray
    ).join('?');
    expect(sql).toContain('SELECT now()');
  });

  it('runs on the transaction it is handed', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ now: DB_NOW }]),
    } as unknown as ClockClient;

    // 事务内的 now() 是 transaction_timestamp：同一个事务里的每一行都盖
    // 同一个瞬间，所以调用方必须能把自己的 tx 递进来。
    await expect(databaseNow(tx)).resolves.toBe(DB_NOW);
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('refuses to fall back to the process clock when no row comes back', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);

    await expect(databaseNow()).rejects.toThrow('database clock unavailable');
  });

  it('refuses a driver value that is not a Date', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ now: '2026-07-17T08:00:00.000Z' }]);

    await expect(databaseNow()).rejects.toThrow('database clock unavailable');
  });
});
