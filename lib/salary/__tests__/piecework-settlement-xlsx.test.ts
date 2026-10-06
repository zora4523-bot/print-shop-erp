import { inflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: { pieceworkSettlement: { findMany: findManyMock } },
}));

import {
  buildPieceworkSettlementWorkbook,
  loadPieceworkSettlementExportData,
} from '../piecework-settlement-xlsx';

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
});

it('零报工出勤日薪也导出提成、补足和应发', async () => {
  const date = new Date('2026-10-06');
  findManyMock.mockResolvedValue([{ id: 'attendance-only', workDate: date, status: 'PAID', reportAmount: '0.00', adjustmentAmount: '100.00', payableAmount: '100.00',
    lockedAt: date, paidAt: date, reporter: { displayName: '出勤师傅', username: 'attendance-worker' }, productionWages: [], items: [] }]);
  const rows = await loadPieceworkSettlementExportData({ from: '2026-10-06', to: '2026-10-06' });
  const summary = readZipEntries(await buildPieceworkSettlementWorkbook(rows)).get('xl/worksheets/sheet1.xml')!;
  expect(summary).toContain('日薪补足 / 历史调整');
  expect(summary).toContain('attendance-only');
  expect(summary).toMatch(/<c r="F2"[^>]*><v>0<\/v><\/c>/);
  expect(summary).toMatch(/<c r="G2"[^>]*><v>100<\/v><\/c>/);
  expect(summary).toMatch(/<c r="H2"[^>]*><v>100<\/v><\/c>/);
});

describe('new piecework settlement export', () => {
  it('queries only the new settlement ledger in the requested date range', async () => {
    await loadPieceworkSettlementExportData({
      from: '2026-08-01',
      to: '2026-08-31',
      workerId: 'worker-1',
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workDate: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lt: new Date('2026-09-01T00:00:00.000Z'),
          },
          reporterId: 'worker-1',
        },
      }),
    );
  });

  it('rejects inverted or invalid date ranges before reading data', async () => {
    await expect(
      loadPieceworkSettlementExportData({
        from: '2026-08-31',
        to: '2026-08-01',
      }),
    ).rejects.toThrow(/日期范围不合法/);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('builds a standalone three-sheet xlsx even when the ledger is empty', async () => {
    const workbook = await buildPieceworkSettlementWorkbook([]);

    expect(workbook.subarray(0, 2).toString()).toBe('PK');
    expect(workbook.length).toBeGreaterThan(1_000);
  });
});


it('exports business labels and keeps rule hashes in a linked verification sheet', async () => {
  const date = new Date('2026-10-01T00:00:00Z');
  findManyMock.mockResolvedValue([{
    id: 'settlement-1', workDate: date, status: 'LOCKED', reportAmount: '48.25', adjustmentAmount: '0.00', payableAmount: '48.25',
    lockedAt: date, paidAt: null, reporter: { displayName: '张师傅', username: 'zhang' },
    productionWages: [{ id: 'wage-1', amount: '20.00', job: { label: '初次生产', completedQty: 1000, completedAt: date, order: { orderNo: 'WO-1', customName: '中秋' } } }],
    items: [{ amount: '28.25', report: {
      id: 'report-1', entryType: 'REPORT', reportedCompletedQty: '1000', defectQty: '2', reworkQty: '0', chargeableQty: '1000',
      unit: 'PER_PIECE', rate: '0.02825', amount: '28.25', priceBookVersion: 7, ruleSetSha256: 'a'.repeat(64), reportedAt: date,
      snapshot: { payroll: { rateSource: 'PERSONAL', policyBookVersion: 9 } },
      operation: { operationType: 'PARTIAL', order: { orderNo: 'WO-1', customName: '中秋' } },
    } }],
  }]);
  const data = await loadPieceworkSettlementExportData({ from: '2026-10-01', to: '2026-10-01' });
  const entries = readZipEntries(await buildPieceworkSettlementWorkbook(data));
  const workbook = entries.get('xl/workbook.xml')!;
  for (const title of ['计件结算', '报工明细', '核验记录']) expect(workbook).toContain(`name="${title}"`);
  expect(entries.get('xl/_rels/workbook.xml.rels')).toContain('Target="worksheets/sheet3.xml"');
  expect(entries.get('[Content_Types].xml')).toContain('PartName="/xl/worksheets/sheet3.xml"');
  const summary = entries.get('xl/worksheets/sheet1.xml')!;
  const detail = entries.get('xl/worksheets/sheet2.xml')!;
  const verification = entries.get('xl/worksheets/sheet3.xml')!;
  for (const text of ['计件工资', '完工提成', '局部烫金', '个人工价', '>个<', '28.25', '20', 'report-1']) expect(detail).toContain(text);
  for (const text of ['48.25', '张师傅', 'settlement-1']) expect(summary).toContain(text);
  for (const sheet of [summary, detail]) {
    expect(sheet).not.toMatch(/PIECEWORK|ORDER_PRODUCTION|PARTIAL|PER_PIECE|PERSONAL|SHA256/);
    expect(sheet).not.toContain('a'.repeat(64));
    const rows = [...sheet.matchAll(/<row[^>]*>(.*?)<\/row>/g)].map((row) => [...row[1]!.matchAll(/<c\b/g)].length);
    expect(new Set(rows).size).toBe(1);
  }
  for (const text of ['settlement-1', 'report-1', 'a'.repeat(64), '规则校验码']) expect(verification).toContain(text);
});

function readZipEntries(file: Buffer): Map<string, string> {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = file.lastIndexOf(endSignature);
  if (endOffset < 0) throw new Error('missing ZIP end-of-central-directory');
  const entryCount = file.readUInt16LE(endOffset + 10);
  let centralOffset = file.readUInt32LE(endOffset + 16);
  const entries = new Map<string, string>();

  for (let index = 0; index < entryCount; index += 1) {
    if (file.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error('invalid ZIP central-directory entry');
    }
    const method = file.readUInt16LE(centralOffset + 10);
    const compressedSize = file.readUInt32LE(centralOffset + 20);
    const fileNameLength = file.readUInt16LE(centralOffset + 28);
    const extraLength = file.readUInt16LE(centralOffset + 30);
    const commentLength = file.readUInt16LE(centralOffset + 32);
    const localOffset = file.readUInt32LE(centralOffset + 42);
    const name = file
      .subarray(centralOffset + 46, centralOffset + 46 + fileNameLength)
      .toString('utf8');

    if (file.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('invalid ZIP local-file entry');
    }
    const localNameLength = file.readUInt16LE(localOffset + 26);
    const localExtraLength = file.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = file.subarray(dataStart, dataStart + compressedSize);
    const content =
      method === 0
        ? compressed
        : method === 8
          ? inflateRawSync(compressed)
          : unsupportedCompression(method);
    entries.set(name, content.toString('utf8'));
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function unsupportedCompression(method: number): never {
  throw new Error(`unsupported ZIP compression method: ${method}`);
}
