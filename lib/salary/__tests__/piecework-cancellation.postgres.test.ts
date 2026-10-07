import { randomUUID, createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { cancelPieceworkSchedule, reviewPieceworkCancellation } from '../piecework-cancellation';
import { createPersonalPieceworkDraft, savePersonalPieceworkDraft, publishPersonalPieceworkDraft } from '../personal-piecework-admin';
import { lockPieceworkSettlement } from '../piecework-settlement';
import { listOrderWages, reviewOrderWages } from '../order-wage-review';
import { formatDateInputShanghai } from '@/lib/format/dates';
import { resolveReporterPieceworkRate } from '../piecework-rate-selection';
import type { PieceworkCancellationInput } from '../piecework-cancellation-input';

vi.mock('server-only', () => ({}));
const url = process.env.DATABASE_URL;
const isolated = Boolean(url && url === process.env.E2E_DATABASE_URL && new URL(url).pathname.slice(1) === process.env.E2E_DATABASE_CONFIRM_DATABASE && /(?:^|_)e2e_/.test(new URL(url).pathname));
const postgres = isolated ? describe : describe.skip;
const prefix = `cancel_${randomUUID().replaceAll('-', '')}`;
const actor = { id: `${prefix}_admin`, username: `${prefix}_admin`, displayName: '调价取消测试管理员', role: 'ADMIN' as const };
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
async function worker() {
  const id = `cancel_${randomUUID().replaceAll('-', '')}`;
  await db.user.create({ data: { id, username: id, password: 'not-a-login-hash', displayName: '调价回归师傅', role: 'WORKER', workerType: 'MACHINE', machineType: 'HAND_PRESS' } });
  return id;
}
async function publish(workerId: string, at = '', rate: string | null = '0.1234') {
  const draft = await createPersonalPieceworkDraft(workerId, actor);
  const saved = await savePersonalPieceworkDraft({ workerId, version: draft.version, updatedAt: draft.updatedAt, effectiveFrom: at, useUnifiedRates: rate === null, partial: rate ?? '', full: '', bag: '', box: '', publishNote: '取消计划回归', sourceName: '自动化回归' }, actor);
  const published = await publishPersonalPieceworkDraft({ workerId, version: saved.version, updatedAt: saved.updatedAt }, actor);
  return db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: published.id }, include: { rules: true } });
}
async function fixture() {
  const workerId = await worker();
  const p = await publish(workerId);
  const s = await publish(workerId, future(10), '0.4567');
  const n = await publish(workerId, future(20), null);
  return { workerId, p: await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: p.id }, include: { rules: true } }), s: await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: s.id }, include: { rules: true } }), n };
}
async function input(workerId: string, id: string): Promise<PieceworkCancellationInput> {
  return { clientRequestId: randomUUID(), reason: '误填生效时间', review: await reviewPieceworkCancellation(workerId, id, actor) };
}
async function client() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
async function operation() {
  const order = await db.order.create({ data: { orderNo: `CANCEL-${randomUUID()}`, submitterId: `${prefix}_sales`, createdById: actor.id, submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES' } });
  return db.productionOperation.create({ data: { orderId: order.id, operationType: 'PARTIAL', unit: 'PER_PASS', plannedQty: 1000 } });
}
async function reportSql(c: Client, workerId: string, operationId: string, book: { id: string; version: number; ruleSetSha256: string | null }, at: Date, policyId: string | null, rate = '0.1234') {
  const id = randomUUID();
  await c.query(`INSERT INTO "ProductionReport" (id,"operationId","reporterId","reportedCompletedQty","chargeableQty",unit,rate,amount,"priceBookId","priceBookVersion","ruleSetSha256",snapshot,"idempotencyKey","reportedAt") VALUES ($1::text,$2,$3,10,10,'PER_PASS',$4,round(10*$4::numeric,2),$5,$6,$7,$8::jsonb,$1,$9)`, [id, operationId, workerId, rate, book.id, book.version, book.ruleSetSha256, JSON.stringify({ payroll: { policyBookId: policyId } }), at]);
  return id;
}
/** Uses the same ledger facts with direct SQL, independently of domain guards. */
async function insertOperation(c: Client, x: PieceworkCancellationInput, override: Record<string, unknown> = {}) {
  const { target: s, predecessor: p, successor: n } = x.review;
  const values: Record<string, unknown> = {
    id: randomUUID(), clientRequestId: x.clientRequestId, actorId: actor.id, workerId: x.review.workerId,
    targetBookId: s.id, targetEffectiveFrom: s.effectiveFrom, targetEffectiveTo: s.effectiveTo, targetUpdatedAt: s.updatedAt,
    predecessorBookId: p?.id ?? null, predecessorPreviousTo: p?.effectiveTo ?? null, predecessorNewTo: p ? s.effectiveTo : null, predecessorUpdatedAt: p?.updatedAt ?? null,
    successorBookId: n?.id ?? null, successorEffectiveFrom: n?.effectiveFrom ?? null, successorEffectiveTo: n?.effectiveTo ?? null, successorUpdatedAt: n?.updatedAt ?? null,
    reason: x.reason, requestHash: createHash('sha256').update(JSON.stringify({ reason: x.reason, review: x.review })).digest('hex'), ...override,
  };
  const columns = Object.keys(values);
  const row = await c.query(`INSERT INTO "PieceworkCancellation" (${columns.map((key) => `"${key}"`).join(',')}, "createdAt") VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}, clock_timestamp()) RETURNING *`, Object.values(values));
  return row.rows[0] as { id: string; createdAt: Date };
}
async function cancelSql(c: Client, x: PieceworkCancellationInput, restore = true) {
  const op = await insertOperation(c, x);
  await c.query(`UPDATE "PieceworkPriceBook" SET status='CANCELLED',"cancelledAt"=$2,"cancelledById"=$3,"cancelReason"=$4,"cancellationId"=$5,"updatedAt"=GREATEST(clock_timestamp(),"updatedAt"+interval '1 millisecond') WHERE id=$1`, [x.review.target.id, op.createdAt, actor.id, x.reason, op.id]);
  if (restore && x.review.predecessor) await c.query(`UPDATE "PieceworkPriceBook" SET "effectiveTo"=$2,"updatedAt"=GREATEST(clock_timestamp(),"updatedAt"+interval '1 millisecond') WHERE id=$1`, [x.review.predecessor.id, x.review.target.effectiveTo]);
  return op;
}
async function negative(run: (c: Client) => Promise<unknown>, pattern: RegExp = /Piecework|piecework|immutable|constraint/) {
  const c = await client();
  try { await c.query('BEGIN'); await expect((async () => { await run(c); await c.query('COMMIT'); })()).rejects.toThrow(pattern); }
  finally { await c.query('ROLLBACK'); await c.end(); }
}
async function waitUntilBlocked(c: Client) {
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    const result = await c.query(`SELECT 1 FROM pg_locks w JOIN pg_locks h ON h.pid=pg_backend_pid() AND h.locktype='advisory' AND h.granted AND w.locktype=h.locktype AND w.database=h.database AND w.classid=h.classid AND w.objid=h.objid AND w.objsubid=h.objsubid WHERE NOT w.granted`);
    if (result.rowCount) return;
  }
  throw new Error('Expected transaction did not wait on publication barrier');
}
async function waitUntilEffective(c: Client, at: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await c.query('SELECT clock_timestamp() >= $1::timestamptz AS crossed', [at])).rows[0].crossed) return;
  }
  throw new Error('Database clock did not cross scheduled boundary');
}

postgres.sequential('piecework cancellation · real isolated PostgreSQL', () => {
  beforeAll(async () => {
    vi.stubEnv('PIECEWORK_SCHEDULE_CANCEL_ENABLED', 'true');
    await db.user.create({ data: { ...actor, password: 'not-a-login-hash' } });
    await db.user.create({ data: { id: `${prefix}_sales`, username: `${prefix}_sales`, displayName: '回归销售', role: 'SALES', password: 'not-a-login-hash' } });
    expect(await db.pieceworkPriceBook.count()).toBeGreaterThan(0);
  });
  afterAll(() => vi.unstubAllEnvs());

  it('can use both reference indexes for the exact cancellation and publication predicate', async () => {
    const c = await client();
    try {
      await c.query('BEGIN');
      // A small fixture may legitimately prefer a scan; this tests index
      // eligibility, not a production planner cost or timing assumption.
      await c.query('SET LOCAL enable_seqscan = off');
      const result = await c.query(`EXPLAIN (FORMAT JSON) SELECT id FROM "ProductionReport" WHERE "priceBookId"=$1 OR snapshot #>> '{payroll,policyBookId}'=$1 LIMIT 1`, [randomUUID()]);
      const plan = JSON.stringify(result.rows);
      expect(plan).toContain('ProductionReport_policyBookId_idx');
      expect(plan).toContain('BitmapOr');
      expect(plan).not.toContain('Seq Scan');
    } finally { await c.query('ROLLBACK'); await c.end(); }
  });

  it('cancels only the middle version, preserves its evidence and successor, replays once', async () => {
    const f = await fixture(); const x = await input(f.workerId, f.s.id);
    const first = await cancelPieceworkSchedule(x, actor);
    expect(await cancelPieceworkSchedule(x, actor)).toEqual({ ...first, replayed: true });
    const cancelled = await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.s.id }, include: { rules: true } });
    const historical = (book: typeof f.s) => Object.fromEntries(Object.entries(book).filter(([key]) => !['status', 'updatedAt', 'cancelledAt', 'cancelledById', 'cancelReason', 'cancellationId'].includes(key)));
    expect(historical(cancelled)).toEqual(historical(f.s));
    expect(cancelled.status).toBe('CANCELLED');
    expect((await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.p.id } })).effectiveTo).toEqual(f.n.effectiveFrom);
    expect(await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.n.id }, include: { rules: true } })).toEqual(f.n);
    expect(await db.businessAuditLog.count({ where: { entityId: f.s.id, action: 'CANCEL_SCHEDULE' } })).toBe(1);
    await expect(cancelPieceworkSchedule({ ...x, reason: '另一种原因' }, actor)).rejects.toThrow('原记录不同');
    await expect(publishPersonalPieceworkDraft({ workerId: f.workerId, version: f.s.version, updatedAt: f.s.updatedAt.toISOString() }, actor)).rejects.toThrow('已取消');
  });

  it('retains an existing draft and requires re-review for adjacent cancellation, then allows immediate correction', async () => {
    const f = await fixture(); const middle = await input(f.workerId, f.s.id); const tail = await input(f.workerId, f.n.id);
    const draft = await createPersonalPieceworkDraft(f.workerId, actor);
    await cancelPieceworkSchedule(middle, actor);
    expect(await createPersonalPieceworkDraft(f.workerId, actor)).toEqual(draft);
    await expect(cancelPieceworkSchedule(tail, actor)).rejects.toThrow('已变化');
    const saved = await savePersonalPieceworkDraft({ workerId: f.workerId, version: draft.version, updatedAt: draft.updatedAt, partial: '', full: '', bag: '', box: '', effectiveFrom: '', useUnifiedRates: true, publishNote: '恢复统一工价' }, actor);
    await expect(publishPersonalPieceworkDraft({ workerId: f.workerId, version: saved.version, updatedAt: saved.updatedAt }, actor)).rejects.toThrow('新工价只能安排在其后');
    await cancelPieceworkSchedule(await input(f.workerId, f.n.id), actor);
    expect((await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.p.id } })).effectiveTo).toBeNull();
    const corrected = await publishPersonalPieceworkDraft({ workerId: f.workerId, version: saved.version, updatedAt: saved.updatedAt }, actor);
    expect(corrected.status).toBe('PUBLISHED');
    expect(corrected.useUnifiedRates).toBe(true);
  });

  it('first personal cancellation falls back to unified; new draft never copies a cancelled price', async () => {
    const workerId = await worker(); const s = await publish(workerId, future(10), '9.9999');
    await cancelPieceworkSchedule(await input(workerId, s.id), actor);
    const resolved = await db.$transaction((tx) => resolveReporterPieceworkRate(tx, workerId, 'PARTIAL', 'PER_PASS', new Date(future(11))));
    expect(resolved.book.workerId).toBeNull(); expect(resolved.policy).toBeUndefined();
    const draft = await createPersonalPieceworkDraft(workerId, actor);
    expect(draft.version).toBeGreaterThan(s.version); expect(draft.useUnifiedRates).toBe(true); expect(draft.rules).toHaveLength(0);
  });

  it('permits cancellation for an inactive worker, rejects scope and actor forgery and effective versions', async () => {
    const f = await fixture(); const x = await input(f.workerId, f.s.id);
    await expect(reviewPieceworkCancellation(null, f.s.id, actor)).rejects.toThrow('不属于');
    await expect(reviewPieceworkCancellation(f.workerId, f.p.id, actor)).rejects.toThrow('已经生效');
    await expect(cancelPieceworkSchedule(x, { ...actor, role: 'SALES' })).rejects.toThrow('活跃管理员');
    await expect(cancelPieceworkSchedule(x, { ...actor, username: 'forged' })).rejects.toThrow('活跃管理员');
    await db.user.update({ where: { id: f.workerId }, data: { isActive: false } });
    await cancelPieceworkSchedule(x, actor);
    expect((await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.s.id } })).status).toBe('CANCELLED');
  });

  it('appended publication invalidates the old cancellation preview', async () => {
    const workerId = await worker(); const s = await publish(workerId, future(10)); const x = await input(workerId, s.id);
    await publish(workerId, future(20));
    await expect(cancelPieceworkSchedule(x, actor)).rejects.toThrow('已变化');
    expect(await db.pieceworkCancellation.count({ where: { targetBookId: s.id } })).toBe(0);
  });

  it('concurrent identical cancellations commit one operation and one audit', async () => {
    const f = await fixture(); const x = await input(f.workerId, f.s.id);
    const results = await Promise.all([cancelPieceworkSchedule(x, actor), cancelPieceworkSchedule(x, actor)]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(await db.pieceworkCancellation.count({ where: { targetBookId: f.s.id } })).toBe(1);
  });

  it('concurrent adjacent previews permit one cancellation and reject the stale other', async () => {
    const f = await fixture(); const a = await input(f.workerId, f.s.id); const b = await input(f.workerId, f.n.id);
    const results = await Promise.allSettled([cancelPieceworkSchedule(a, actor), cancelPieceworkSchedule(b, actor)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => String(r.reason))).toEqual([expect.stringContaining('已变化')]);
  });

  for (const cancelFirst of [true, false]) it(`concurrent publication and cancellation, ${cancelFirst ? 'cancellation' : 'publication'} obtains the boundary first`, async () => {
    const workerId = await worker(); const p = await publish(workerId); const target = await publish(workerId, future(10)); const x = await input(workerId, target.id);
    const draft = await createPersonalPieceworkDraft(workerId, actor);
    const saved = await savePersonalPieceworkDraft({ workerId, version: draft.version, updatedAt: draft.updatedAt, effectiveFrom: future(20), useUnifiedRates: true, partial: '', full: '', bag: '', box: '', publishNote: '并发后继发布' }, actor);
    const publication = () => publishPersonalPieceworkDraft({ workerId, version: saved.version, updatedAt: saved.updatedAt }, actor);
    const cancellation = () => cancelPieceworkSchedule(x, actor);
    const gate = await client(); const pending: Promise<PromiseSettledResult<unknown>>[] = [];
    try {
      await gate.query('BEGIN'); await gate.query("SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))");
      const settle = (run: () => Promise<unknown>) => run().then((value): PromiseFulfilledResult<unknown> => ({ status: 'fulfilled', value }), (reason: unknown): PromiseRejectedResult => ({ status: 'rejected', reason }));
      pending.push(settle(cancelFirst ? cancellation : publication)); await waitUntilBlocked(gate);
      // The first owns this worker's identity boundary before it waits on the
      // gate; the second cannot pass it regardless of scheduler timing.
      pending.push(settle(cancelFirst ? publication : cancellation));
      await gate.query('COMMIT'); const results = await Promise.all(pending);
      expect(results[0]!.status).toBe('fulfilled');
      expect(results[1]!.status).toBe(cancelFirst ? 'fulfilled' : 'rejected');
      if (!cancelFirst && results[1]!.status === 'rejected') expect(String(results[1]!.reason)).toContain('已变化');
      const previous = await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: p.id } });
      expect(previous.effectiveTo?.toISOString()).toBe(cancelFirst ? saved.effectiveFrom : target.effectiveFrom!.toISOString());
    } finally { await gate.query('ROLLBACK'); await Promise.all(pending); await gate.end(); }
  });

  it('audit failure rolls back target, predecessor and immutable cancellation receipt together', async () => {
    const f = await fixture(); const x = await input(f.workerId, f.s.id); const c = await client(); const trigger = `cancel_fault_${randomUUID().replaceAll('-', '')}`;
    try {
      await c.query(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId"='${f.s.id}' AND NEW.action='CANCEL_SCHEDULE' THEN RAISE EXCEPTION 'cancellation audit fault injection'; END IF; RETURN NEW; END $$`);
      await c.query(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "BusinessAuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
      await expect(cancelPieceworkSchedule(x, actor)).rejects.toThrow('audit fault injection');
      expect(await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.s.id }, include: { rules: true } })).toEqual(f.s);
      expect(await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.p.id }, include: { rules: true } })).toEqual(f.p);
      expect(await db.pieceworkCancellation.count({ where: { targetBookId: f.s.id } })).toBe(0);
    } finally { await c.query(`DROP TRIGGER IF EXISTS "${trigger}" ON "BusinessAuditLog"`); await c.query(`DROP FUNCTION IF EXISTS "${trigger}"()`); await c.end(); }
  });

  it('SQL rejects operation-only, target-only, predecessor-only and forged neighbours without partial facts', async () => {
    const f = await fixture(); const x = await input(f.workerId, f.s.id);
    await negative((c) => insertOperation(c, x));
    await negative((c) => cancelSql(c, x, false));
    await negative((c) => c.query('UPDATE "PieceworkPriceBook" SET "effectiveTo"=$2 WHERE id=$1', [f.p.id, f.n.effectiveFrom]));
    await negative((c) => insertOperation(c, x, { workerId: null }));
    await negative((c) => insertOperation(c, x, { predecessorBookId: null, predecessorPreviousTo: null, predecessorNewTo: null, predecessorUpdatedAt: null }));
    await negative((c) => insertOperation(c, x, { successorBookId: f.p.id }));
    await negative((c) => insertOperation(c, x, { createdTransactionId: 1 }));
    expect(await db.pieceworkCancellation.count({ where: { targetBookId: f.s.id } })).toBe(0);
    expect((await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.p.id } })).effectiveTo).toEqual(f.s.effectiveFrom);
    const c = await client(); try { await c.query('BEGIN'); await cancelSql(c, x); await c.query('COMMIT'); } finally { await c.end(); }
    expect((await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: f.s.id } })).status).toBe('CANCELLED');
  });

  it('SQL cancellation terminal and rule guards reject updates, deletion, insertion and moving rules in either direction', async () => {
    const workerId = await worker(); const s = await publish(workerId, future(10));
    const result = await cancelPieceworkSchedule(await input(workerId, s.id), actor);
    const draft = await createPersonalPieceworkDraft(workerId, actor);
    await db.pieceworkPriceRule.create({ data: { priceBookId: draft.id, operationType: 'PARTIAL', unit: 'PER_PASS', amount: '0.5' } });
    for (const sql of [
      `UPDATE "PieceworkPriceBook" SET status='DRAFT' WHERE id=$1`,
      `UPDATE "PieceworkPriceBook" SET status='PUBLISHED' WHERE id=$1`,
      `UPDATE "PieceworkPriceBook" SET "effectiveFrom"=clock_timestamp() WHERE id=$1`,
      `DELETE FROM "PieceworkPriceBook" WHERE id=$1`,
      `UPDATE "PieceworkPriceRule" SET amount=8 WHERE "priceBookId"=$1`,
      `DELETE FROM "PieceworkPriceRule" WHERE "priceBookId"=$1`,
      `INSERT INTO "PieceworkPriceRule" (id,"priceBookId","operationType",unit,amount,"updatedAt") VALUES ('${randomUUID()}',$1,'FULL','PER_PIECE',1,clock_timestamp())`,
    ]) await negative((c) => c.query(sql, [s.id]));
    await negative((c) => c.query('UPDATE "PieceworkPriceRule" SET "priceBookId"=$2 WHERE "priceBookId"=$1', [s.id, draft.id]));
    await negative((c) => c.query('UPDATE "PieceworkPriceRule" SET "priceBookId"=$2 WHERE "priceBookId"=$1', [draft.id, s.id]));
    await negative((c) => c.query('UPDATE "PieceworkCancellation" SET reason=$2 WHERE id=$1', [result.cancellationId, '伪造原因']));
    await negative((c) => c.query('DELETE FROM "PieceworkCancellation" WHERE id=$1', [result.cancellationId]));
  });

  it('domain checks real clock after the publication lock, not transaction start', async () => {
    const workerId = await worker(); const s = await publish(workerId, new Date(Date.now() + 1800).toISOString()); const x = await input(workerId, s.id);
    const gate = await client(); let pending: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      await gate.query('BEGIN'); await gate.query("SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))");
      pending = cancelPieceworkSchedule(x, actor).then((value) => ({ status: 'fulfilled', value }), (reason: unknown) => ({ status: 'rejected', reason }));
      await waitUntilBlocked(gate); await waitUntilEffective(gate, x.review.target.effectiveFrom); await gate.query('COMMIT');
      expect(await pending).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('已经生效') }) });
      expect(await db.pieceworkCancellation.count({ where: { targetBookId: s.id } })).toBe(0);
    } finally { await gate.query('ROLLBACK'); await pending; await gate.end(); }
  });

  it('deferred SQL validation rolls back a transaction that crosses the effective boundary before commit', async () => {
    const workerId = await worker(); const s = await publish(workerId, new Date(Date.now() + 1800).toISOString()); const x = await input(workerId, s.id);
    const c = await client();
    try { await c.query('BEGIN'); await cancelSql(c, x); await waitUntilEffective(c, x.review.target.effectiveFrom); await expect(c.query('COMMIT')).rejects.toThrow(/at commit/); }
    finally { await c.query('ROLLBACK'); await c.end(); }
    expect((await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('PUBLISHED');
    expect(await db.pieceworkCancellation.count({ where: { targetBookId: s.id } })).toBe(0);
  });

  it.each(['direct', 'policy'] as const)('rejects a future version with an existing %s report reference, including direct SQL cancellation', async (kind) => {
    const workerId = await worker(); const s = await publish(workerId, future(10), kind === 'policy' ? null : '0.1234'); const x = await input(workerId, s.id); const op = await operation();
    const rateBook = kind === 'direct' ? s : await db.pieceworkPriceBook.findFirstOrThrow({ where: { workerId: null, status: 'PUBLISHED', effectiveTo: null }, include: { rules: true } });
    const rate = rateBook.rules.find((r) => r.operationType === 'PARTIAL')!.amount!.toString();
    const c = await client();
    try {
      // A future-dated fixture using the shared unified book must not become
      // durable: it would correctly prohibit unrelated later immediate prices.
      // Validate the SQL policy-reference guard in the same rolled-back tx.
      if (kind === 'policy') await c.query('BEGIN');
      await reportSql(c, workerId, op.id, rateBook, new Date(s.effectiveFrom!.getTime() + 1), s.id, rate);
      if (kind === 'policy') { await expect(insertOperation(c, x)).rejects.toThrow(/referenced/); return; }
    } finally { await c.query('ROLLBACK'); await c.end(); }
    await expect(cancelPieceworkSchedule(x, actor)).rejects.toThrow('已有报工');
    await negative((c) => insertOperation(c, x), /referenced/);
    expect(await db.pieceworkCancellation.count({ where: { targetBookId: s.id } })).toBe(0);
  });

  it('new direct or policy references to a cancelled version fail before ledger insertion', async () => {
    const workerId = await worker(); const s = await publish(workerId, future(10)); const op = await operation();
    await cancelPieceworkSchedule(await input(workerId, s.id), actor);
    const unified = await db.pieceworkPriceBook.findFirstOrThrow({ where: { workerId: null, status: 'PUBLISHED', effectiveTo: null } });
    await negative((c) => reportSql(c, workerId, op.id, s, s.effectiveFrom!, s.id), /cancelled/);
    await negative((c) => reportSql(c, workerId, op.id, unified, s.effectiveFrom!, s.id), /cancelled/);
    expect(await db.productionReport.count({ where: { operationId: op.id } })).toBe(0);
  });

  it.each([
    { reportedAt: '2026-10-05T02:00:00.000Z', payable: '1.23', supplement: '0.00' },
    { reportedAt: '2026-10-06T02:00:00.000Z', payable: '100.00', supplement: '98.77' },
  ])('historical reports, rates and locked settlement amounts stay byte-equivalent ($reportedAt)', async ({ reportedAt, payable, supplement }) => {
    const workerId = await worker(); const draft = await createPersonalPieceworkDraft(workerId, actor); const c = await client();
    const at = new Date(reportedAt); const op = await operation();
    try {
      await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))");
      await c.query('UPDATE "PieceworkPriceBook" SET "useUnifiedRates"=false WHERE id=$1', [draft.id]);
      await c.query(`INSERT INTO "PieceworkPriceRule" (id,"priceBookId","operationType",unit,amount,"updatedAt") VALUES ($1,$2,'PARTIAL','PER_PASS',0.1234,clock_timestamp())`, [randomUUID(), draft.id]);
      await c.query(`UPDATE "PieceworkPriceBook" SET status='PUBLISHED',"effectiveFrom"=$2,"publishedById"=$3,"publishedAt"=clock_timestamp(),"sourceName"='历史夹具',"publishNote"='历史工资夹具',"sourceSha256"=repeat('a',64),"manifestSha256"=repeat('b',64),"ruleSetSha256"=repeat('c',64) WHERE id=$1`, [draft.id, new Date(at.getTime() - 1000), actor.id]);
      await c.query('COMMIT');
      const p = await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: draft.id } });
      await reportSql(c, workerId, op.id, p, at, p.id);
    } finally { await c.query('ROLLBACK'); await c.end(); }
    const settled = await lockPieceworkSettlement({ reporterId: workerId, workDate: formatDateInputShanghai(at), actor });
    const snapshot = async () => ({ reports: await db.productionReport.findMany({ where: { reporterId: workerId } }), settlement: await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: settled.id }, include: { items: true } }), rules: await db.pieceworkPriceRule.findMany({ where: { priceBookId: draft.id } }) });
    const before = await snapshot();
    const s = await publish(workerId, future(10)); await cancelPieceworkSchedule(await input(workerId, s.id), actor);
    expect(await snapshot()).toEqual(before);
    expect(before.settlement.payableAmount.toFixed(2)).toBe(payable);
    expect(before.settlement.reportAmount.toFixed(2)).toBe('1.23');
    expect(before.settlement.adjustmentAmount.toFixed(2)).toBe(supplement);
    expect(before.settlement.items).toHaveLength(1);
  });

  it('SQL reporting takes the order boundary before shared publication and cannot block cancellation while waiting for an order', async () => {
    const workerId = await worker(); const p = await publish(workerId); const s = await publish(workerId, future(10)); const x = await input(workerId, s.id); const op = await operation();
    const gate = await client(); const reporter = await client(); let pending: Promise<unknown> | undefined;
    try {
      await gate.query('BEGIN'); await gate.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`print-shop-erp:order-cascade:${op.orderId}`]);
      pending = reportSql(reporter, workerId, op.id, p, new Date(), p.id).then((value) => ({ status: 'fulfilled', value }), (reason: unknown) => ({ status: 'rejected', reason }));
      await waitUntilBlocked(gate);
      // The previous trigger acquired shared publication before waiting for this
      // order; try-lock proves that ordering regression without relying on sleeps.
      const lock = await gate.query("SELECT pg_try_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish')) AS obtained");
      expect(lock.rows[0].obtained).toBe(true);
      await cancelSql(gate, x); await gate.query('COMMIT'); expect(await pending).toMatchObject({ status: 'fulfilled' });
      expect(await db.productionReport.count({ where: { operationId: op.id } })).toBe(1);
    } finally { await gate.query('ROLLBACK'); await pending; await gate.end(); await reporter.end(); }
  });

  it('report vs cancellation serializes both orders: committed references block cancellation; cancelled plans block new reports', async () => {
    for (const reportFirst of [true, false]) {
      const workerId = await worker(); const s = await publish(workerId, future(10)); const x = await input(workerId, s.id); const op = await operation();
      const a = await client(); const b = await client(); let pending: Promise<PromiseSettledResult<unknown>> | undefined;
      try {
        await a.query('BEGIN');
        if (reportFirst) await reportSql(a, workerId, op.id, s, s.effectiveFrom!, s.id);
        else await cancelSql(a, x);
        pending = (reportFirst ? cancelPieceworkSchedule(x, actor) : reportSql(b, workerId, op.id, s, s.effectiveFrom!, s.id)).then((value) => ({ status: 'fulfilled', value }), (reason: unknown) => ({ status: 'rejected', reason }));
        await waitUntilBlocked(a); await a.query('COMMIT');
        const result = await pending;
        expect(result.status).toBe('rejected'); if (result.status === 'rejected') expect(String(result.reason)).toContain(reportFirst ? '已有报工' : 'cancelled');
        expect(await db.productionReport.count({ where: { operationId: op.id } })).toBe(reportFirst ? 1 : 0);
      } finally { await a.query('ROLLBACK'); await pending; await a.end(); await b.end(); }
    }
  });

  it('manual wage review enters publication before the reporting day, so a queued cancellation cannot form a lock cycle', async () => {
    const workerId = await worker(); const p = await publish(workerId); const op = await operation();
    const gate = await client(); let pending: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      const at = new Date();
      const anchorId = await reportSql(gate, workerId, op.id, p, at, p.id);
      const wage = (await listOrderWages(op.orderId, actor))[0]!;
      const s = await publish(workerId, future(10)); const x = await input(workerId, s.id);
      await gate.query('BEGIN'); await gate.query("SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))");
      pending = reviewOrderWages({ operationId: op.id, revision: wage.revision, reason: '核定实际工资', targets: [{ anchorId, amount: '2.00' }] }, actor)
        .then((value) => ({ status: 'fulfilled', value }), (reason: unknown) => ({ status: 'rejected', reason }));
      await waitUntilBlocked(gate);
      const dayLock = await gate.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS obtained', [`print-shop-erp:piecework-reporting-day:${formatDateInputShanghai(at)}`]);
      expect(dayLock.rows[0].obtained).toBe(true);
      await cancelSql(gate, x); await gate.query('COMMIT');
      expect(await pending).toMatchObject({ status: 'fulfilled' });
      const reports = await db.productionReport.findMany({ where: { operationId: op.id } });
      expect(reports.filter((row) => row.entryType === 'ADJUSTMENT')).toHaveLength(1);
      expect(reports.map((row) => row.amount.toFixed(2)).sort()).toEqual(['0.77', '1.23']);
      expect((await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('CANCELLED');
    } finally { await gate.query('ROLLBACK'); await pending; await gate.end(); }
  });

  it('feature flag rejects review and mutation at the domain boundary', async () => {
    const workerId = await worker(); const s = await publish(workerId, future(10)); const x = await input(workerId, s.id);
    vi.stubEnv('PIECEWORK_SCHEDULE_CANCEL_ENABLED', 'false');
    try { await expect(reviewPieceworkCancellation(workerId, s.id, actor)).rejects.toThrow('尚未开放'); await expect(cancelPieceworkSchedule(x, actor)).rejects.toThrow('尚未开放'); }
    finally { vi.stubEnv('PIECEWORK_SCHEDULE_CANCEL_ENABLED', 'true'); }
    expect(await db.pieceworkCancellation.count({ where: { targetBookId: s.id } })).toBe(0);
  });
});
