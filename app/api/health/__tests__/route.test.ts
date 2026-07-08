import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { $queryRaw: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { GET } from '../route';

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
});

describe('GET /api/health', () => {
  it('DB 可查 → 200 {status:ok, db:ok}', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
    // 不泄漏敏感信息：只有 status/db/version/time 四个键
    expect(Object.keys(body).sort()).toEqual(['db', 'status', 'time', 'version']);
  });

  it('DB 查询抛错 → 503 {status:error, db:down}，不泄漏错误详情', async () => {
    dbMock.$queryRaw.mockRejectedValue(new Error('connection refused: 密码错误'));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'error', db: 'down' });
    // 错误 message 不落进响应体
    expect(JSON.stringify(body)).not.toMatch(/connection refused|密码/);
  });
});
