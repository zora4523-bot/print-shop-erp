import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { cancelPieceworkSchedule, reviewPieceworkCancellation } from '../piecework-cancellation';
import { createPieceworkDraft, savePieceworkDraft, publishSavedPieceworkDraft } from '../piecework-admin';
import { seedPieceworkPriceBookV1Placeholder } from '../piecework-price-book-seed';
import { resolveReporterPieceworkRate } from '../piecework-rate-selection';
import { createPersonalPieceworkDraft, savePersonalPieceworkDraft, publishPersonalPieceworkDraft } from '../personal-piecework-admin';

vi.mock('server-only', () => ({}));
const url = process.env.DATABASE_URL;
const isolated = Boolean(url && url === process.env.E2E_DATABASE_URL && new URL(url).pathname.slice(1) === process.env.E2E_DATABASE_CONFIRM_DATABASE && /(?:^|_)e2e_/.test(new URL(url).pathname));
const fresh = isolated && process.env.E2E_PIECEWORK_MIGRATION_FIXTURE === 'fresh' ? describe : describe.skip;
const upgrade = isolated && process.env.E2E_PIECEWORK_MIGRATION_FIXTURE === 'upgrade' ? describe : describe.skip;
const actor = { id: 'd-first-admin', username: 'd-first-admin', displayName: '首版回归管理员', role: 'ADMIN' as const };
fresh.sequential('full migration chain · empty unified scope', () => {
  beforeAll(async () => {
    expect(await db.pieceworkPriceBook.count()).toBe(0);
    vi.stubEnv('PIECEWORK_SCHEDULE_CANCEL_ENABLED', 'true');
    await db.user.create({ data: { ...actor, password: 'not-a-login-hash' } });
  });
  afterAll(() => vi.unstubAllEnvs());
  it('cancels the first unified publication, blocks all unconfigured rates, preserves seed history and permits correction', async () => {
    const draft = await createPieceworkDraft(actor);
    const saved = await savePieceworkDraft({ version: draft.version, updatedAt: draft.updatedAt, partial: '0.0100', full: '0.0200', bag: '', box: '', effectiveFrom: '2035-01-01T00:00:00.000Z', sourceName: '首版工价', publishNote: '首版工价回归' }, actor);
    await publishSavedPieceworkDraft({ version: saved.version, updatedAt: saved.updatedAt }, actor);
    const review = await reviewPieceworkCancellation(null, saved.id, actor);
    expect(review.predecessor).toBeNull(); expect(review.successor).toBeNull();
    await cancelPieceworkSchedule({ clientRequestId: randomUUID(), reason: '首版时间误填', review }, actor);
    const cancelled = await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: saved.id }, include: { rules: true } });
    await expect(db.$transaction((tx) => resolveReporterPieceworkRate(tx, 'unconfigured-worker', 'PARTIAL', 'PER_PASS', new Date('2035-01-02')))).rejects.toThrow('统一工价未发布');
    expect(await seedPieceworkPriceBookV1Placeholder(db)).toMatchObject({ status: 'CANCELLED', createdBook: false, createdRules: 0 });
    expect(await db.pieceworkPriceBook.findUniqueOrThrow({ where: { id: saved.id }, include: { rules: true } })).toEqual(cancelled);
    await expect(publishSavedPieceworkDraft({ version: saved.version, updatedAt: saved.updatedAt }, actor)).rejects.toThrow('已取消');
    const workerId = 'd-first-worker';
    await db.user.create({ data: { id: workerId, username: workerId, displayName: '首版个人工价师傅', password: 'not-a-login-hash', role: 'WORKER', workerType: 'MACHINE', machineType: 'HAND_PRESS' } });
    const personal = await createPersonalPieceworkDraft(workerId, actor);
    const personalSaved = await savePersonalPieceworkDraft({ workerId, version: personal.version, updatedAt: personal.updatedAt, partial: '0.0500', full: '', bag: '', box: '', useUnifiedRates: false, effectiveFrom: '2035-01-01T00:00:00.000Z', publishNote: '首版个人工价' }, actor);
    await publishPersonalPieceworkDraft({ workerId, version: personalSaved.version, updatedAt: personalSaved.updatedAt }, actor);
    const personalReview = await reviewPieceworkCancellation(workerId, personalSaved.id, actor);
    expect(personalReview.predecessor).toBeNull();
    await cancelPieceworkSchedule({ clientRequestId: randomUUID(), reason: '首版个人时间误填', review: personalReview }, actor);
    await expect(db.$transaction((tx) => resolveReporterPieceworkRate(tx, workerId, 'PARTIAL', 'PER_PASS', new Date('2035-01-02')))).rejects.toThrow('统一工价未发布');
    const next = await createPieceworkDraft(actor); expect(next.version).toBe(3); expect(next.rules.every((r) => r.amount === '')).toBe(true);
    const corrected = await savePieceworkDraft({ version: next.version, updatedAt: next.updatedAt, partial: '0.0300', full: '0.0400', bag: '', box: '', effectiveFrom: '', sourceName: '纠正工价', publishNote: '立即纠正首版' }, actor);
    await publishSavedPieceworkDraft({ version: corrected.version, updatedAt: corrected.updatedAt }, actor);
    const selected = await db.$transaction((tx) => resolveReporterPieceworkRate(tx, 'unconfigured-worker', 'PARTIAL', 'PER_PASS', new Date()));
    expect(selected.book.id).toBe(next.id); expect(selected.rule.amount.toFixed(4)).toBe('0.0300');
  });
});

upgrade.sequential('167 -> current migration · real historical settlement and personal policy', () => {
  beforeAll(() => vi.stubEnv('PIECEWORK_SCHEDULE_CANCEL_ENABLED', 'true'));
  afterAll(() => vi.unstubAllEnvs());
  it('cancels middle unified and personal plans after upgrade without rewriting historical evidence', async () => {
    const admin = await db.user.findUniqueOrThrow({ where: { id: 'd-upgrade-admin' } });
    const actor = { id: admin.id, username: String(admin.username), displayName: admin.displayName, role: 'ADMIN' as const };
    const history = async () => ({ reports: await db.productionReport.findMany(), settlements: await db.pieceworkSettlement.findMany({ include: { items: true } }), rules: await db.pieceworkPriceRule.findMany({ orderBy: { id: 'asc' } }) });
    const before = await history(); expect(before.reports).toHaveLength(1); expect(before.settlements[0]!.items).toHaveLength(1);
    const successors = await db.pieceworkPriceBook.findMany({ where: { id: { in: ['d-upgrade-book-3', 'd-upgrade-book-6'] } }, orderBy: { id: 'asc' } });
    for (const [workerId, targetId] of [[null, 'd-upgrade-book-2'], ['d-upgrade-worker', 'd-upgrade-book-5']] as const) {
      const review = await reviewPieceworkCancellation(workerId, targetId, actor);
      await cancelPieceworkSchedule({ clientRequestId: randomUUID(), reason: '升级后取消误填计划', review }, actor);
    }
    expect(await history()).toEqual(before);
    expect(await db.pieceworkPriceBook.findMany({ where: { id: { in: successors.map((b) => b.id) } }, orderBy: { id: 'asc' } })).toEqual(successors);
    expect(await db.pieceworkCancellation.count()).toBe(2);
  });
});
