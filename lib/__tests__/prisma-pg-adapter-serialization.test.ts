import { setImmediate as waitForImmediate } from 'node:timers/promises';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';

type Adapter = Awaited<ReturnType<PrismaPg['connect']>>;
type SqlQuery = Parameters<Adapter['queryRaw']>[0];

const emptyResult = {
  command: 'SELECT',
  rowCount: 0,
  oid: 0,
  fields: [],
  rows: [],
};

function query(sql: string): SqlQuery {
  return { sql, args: [], argTypes: [] };
}

function trackingQueryMock() {
  let inFlight = 0;
  let maxInFlight = 0;
  const started: string[] = [];
  const mock = vi.fn(async ({ text }: { text: string }) => {
    started.push(text);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await waitForImmediate();
    inFlight -= 1;
    return emptyResult;
  });

  return { mock, started, maxInFlight: () => maxInFlight };
}

function mockPoolClient(queryMock: ReturnType<typeof vi.fn>) {
  return {
    on: vi.fn(),
    removeListener: vi.fn(),
    query: queryMock,
    release: vi.fn(),
  };
}

function setPoolConnection(pool: pg.Pool, connection: pg.PoolClient) {
  Object.defineProperty(pool, 'connect', {
    configurable: true,
    value: vi.fn(async () => connection),
  });
}

const pools: pg.Pool[] = [];

async function connectedAdapter() {
  const pool = new pg.Pool({
    connectionString: 'postgresql://test:test@127.0.0.1:5432/test',
  });
  pools.push(pool);
  return {
    pool,
    adapter: await new PrismaPg(pool).connect(),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe('@prisma/adapter-pg single-connection query serialization', () => {
  it('serializes concurrent queries on one transaction connection', async () => {
    const { adapter, pool } = await connectedAdapter();
    const tracked = trackingQueryMock();
    const connection = mockPoolClient(tracked.mock);
    setPoolConnection(
      pool,
      connection as unknown as pg.PoolClient,
    );

    const transaction = await adapter.startTransaction();
    await Promise.all([
      transaction.queryRaw(query('SELECT 1')),
      transaction.queryRaw(query('SELECT 2')),
      transaction.queryRaw(query('SELECT 3')),
    ]);

    expect(tracked.started).toEqual([
      'BEGIN',
      'SELECT 1',
      'SELECT 2',
      'SELECT 3',
    ]);
    expect(tracked.maxInFlight()).toBe(1);
    await transaction.commit();
    expect(connection.release).toHaveBeenCalledOnce();
    await adapter.dispose();
  });

  it('does not serialize queries sent to the connection pool', async () => {
    const { adapter, pool } = await connectedAdapter();
    const tracked = trackingQueryMock();
    vi.spyOn(pool, 'query').mockImplementation(
      tracked.mock as unknown as typeof pool.query,
    );

    await Promise.all([
      adapter.queryRaw(query('SELECT 1')),
      adapter.queryRaw(query('SELECT 2')),
      adapter.queryRaw(query('SELECT 3')),
    ]);

    expect(tracked.maxInFlight()).toBe(3);
    await adapter.dispose();
  });

  it('releases the transaction queue after a failed query', async () => {
    const { adapter, pool } = await connectedAdapter();
    const started: string[] = [];
    const queryMock = vi.fn(async ({ text }: { text: string }) => {
      started.push(text);
      await waitForImmediate();
      if (text === 'SELECT fail') {
        throw new Error('expected query failure');
      }
      return emptyResult;
    });
    const connection = mockPoolClient(queryMock);
    setPoolConnection(
      pool,
      connection as unknown as pg.PoolClient,
    );

    const transaction = await adapter.startTransaction();
    const failing = transaction.queryRaw(query('SELECT fail'));
    const following = transaction.queryRaw(query('SELECT after failure'));

    await expect(failing).rejects.toBeDefined();
    await expect(following).resolves.toBeDefined();
    expect(started).toEqual(['BEGIN', 'SELECT fail', 'SELECT after failure']);
    await transaction.rollback();
    await adapter.dispose();
  });
});
