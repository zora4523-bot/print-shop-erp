import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { recordAttendance, removeAttendance } from '@/lib/attendance';
import { getPieceworkSettlementDay, lockPieceworkSettlement, lockPieceworkSettlementsForDate, markPieceworkSettlementPaid } from '../piecework-settlement';
import { dailyMinimumAttendance } from '../daily-minimum-attendance';
vi.mock('server-only', () => ({}));

const url = process.env.DATABASE_URL;
const isolated = !!url && url === process.env.E2E_DATABASE_URL && new URL(url).pathname.slice(1) === process.env.E2E_DATABASE_CONFIRM_DATABASE && /_e2e_/.test(new URL(url).pathname);
const pg = isolated ? describe : describe.skip;
const id = `floor_${randomUUID()}`;
const actor = { id, role: 'ADMIN' as const, displayName: '保底测试管理员', username: id };
const date = '2026-10-06';
const now = new Date('2026-10-07T04:00:00Z');
async function worker() {
  const id = `floor_worker_${randomUUID()}`;
  return db.user.create({ data: { id, username: id, displayName: '保底测试师傅', role: 'WORKER', workerType: 'MACHINE', machineType: 'HAND_PRESS', employmentType: 'FULL_TIME', password: 'not-a-login-hash' } });
}
async function attendance(id: string, workUnits = '1') {
  return recordAttendance(id, date, { normalHours: '4', otHours: '0', workUnits }, actor);
}
pg.sequential('每日保底 · isolated PostgreSQL', () => {
  beforeAll(async () => { await db.user.create({ data: { ...actor, password: 'not-a-login-hash' } }); });
  it('零提成预览、锁定、发放、重放和历史保护一致', async () => {
    const w = await worker(); const att = await attendance(w.id, '0.5');
    const preview = await getPieceworkSettlementDay({ workDate: date, reporterId: w.id });
    expect(preview.candidates).toMatchObject([{ reportAmount: '0.00', adjustmentAmount: '100.00', payableAmount: '100.00', reportCount: 0 }]);
    const result = await lockPieceworkSettlement({ reporterId: w.id, workDate: date, actor, now });
    expect(result).toMatchObject({ reportAmount: '0.00', adjustmentAmount: '100.00', payableAmount: '100.00', reportCount: 0 });
    const row = await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.snapshot).toMatchObject({ dailyMinimum: { version: 1, eligibility: 'ATTENDANCE', attendance: [{ id: att.id, workUnits: '0.5' }] } });
    await expect(attendance(w.id)).rejects.toThrow('该日工资已锁定');
    await expect(removeAttendance(w.id, date, actor)).rejects.toThrow('该日工资已锁定');
    expect((await getPieceworkSettlementDay({ workDate: date, reporterId: w.id, status: 'PAID' })).candidates).toEqual([]);
    await markPieceworkSettlementPaid({ settlementId: result.id, actor });
    const replay = await lockPieceworkSettlement({ reporterId: w.id, workDate: date, actor, now });
    expect(replay).toMatchObject({ id: result.id, payableAmount: '100.00', idempotentReplay: true, status: 'PAID' });
    await expect(db.pieceworkSettlement.update({ where: { id: result.id }, data: { payableAmount: '200' } })).rejects.toThrow();
  });
  it('无出勤、全日请假、未核实身份和销售不领取师傅日薪', async () => {
    const absent = await worker();
    await expect(lockPieceworkSettlement({ reporterId: absent.id, workDate: date, actor, now })).rejects.toMatchObject({ code: 'NO_REPORTS' });
    for (const kind of ['LEAVE', 'UNVERIFIED', 'SALES'] as const) {
      const w = await worker();
      await db.attendance.create({ data: { workerId: w.id, date: new Date(date), createdById: actor.id, roleSnapshot: kind === 'SALES' ? 'SALES' : 'WORKER',
        workerTypeSnapshot: kind === 'SALES' ? null : 'MACHINE', workUnits: kind === 'LEAVE' ? 0 : 1, leaveUnits: kind === 'LEAVE' ? 1 : 0, identitySnapshotVerified: kind !== 'UNVERIFIED' } });
      expect(await dailyMinimumAttendance(db, date, w.id)).toEqual([]);
      await expect(lockPieceworkSettlement({ reporterId: w.id, workDate: date, actor, now })).rejects.toMatchObject({ code: 'NO_REPORTS' });
    }
  });
  it('原日考勤快照不随账号改岗改变', async () => {
    const w = await worker(); await attendance(w.id);
    await db.user.update({ where: { id: w.id }, data: { role: 'SALES', workerType: null, machineType: null } });
    expect((await lockPieceworkSettlement({ reporterId: w.id, workDate: date, actor, now })).payableAmount).toBe('100.00');
  });
  it('批量发现出勤，重试不重复创建', async () => {
    const w = await worker(); await attendance(w.id);
    const result = await lockPieceworkSettlementsForDate({ workDate: date, actor, now });
    expect(result.settled.find(row => row.reporterId === w.id)).toMatchObject({ payableAmount: '100.00' });
    const retry = await lockPieceworkSettlementsForDate({ workDate: date, actor, now });
    expect(retry.settled.some(row => row.reporterId === w.id)).toBe(false);
    expect(await db.pieceworkSettlement.count({ where: { reporterId: w.id } })).toBe(1);
  });
  it('并发删除考勤和锁定不会留下失去出勤依据的日薪', async () => {
    const w = await worker(); await attendance(w.id);
    const results = await Promise.allSettled([lockPieceworkSettlement({ reporterId: w.id, workDate: date, actor, now }), removeAttendance(w.id, date, actor)]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const frozen = await db.pieceworkSettlement.findUnique({ where: { reporterId_workDate: { reporterId: w.id, workDate: new Date(date) } } });
    const att = await db.attendance.findUnique({ where: { workerId_date: { workerId: w.id, date: new Date(date) } } });
    expect(Boolean(frozen)).toBe(Boolean(att));
  });
  it('师傅本人和销售无权锁定日薪', async () => {
    const w = await worker(); await attendance(w.id);
    for (const role of ['WORKER', 'SALES'] as const) await expect(lockPieceworkSettlement({ reporterId: w.id, workDate: date, actor: { ...actor, role }, now })).rejects.toMatchObject({ code: 'INVALID_ACTOR' });
  });
});
