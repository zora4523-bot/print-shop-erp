import { ZipArchive } from 'archiver';
import { PassThrough } from 'node:stream';
import {
  MachineType,
  SalaryAdjustmentType,
  type Prisma,
} from '../../generated/prisma/client';
import { db } from '../db';
import { parseStrictYmd } from '../auth/schemas';
import { MACHINE_TYPE_LABELS } from '../auth/role-labels';
import { xlsxColumnName } from '../export/xlsx-column';
import type { LegacyMachineRuleSnapshot } from './legacy-machine-snapshot';

export type PieceworkExportFilter = {
  from: string;
  to: string;
  workerId?: string;
};

export class PieceworkExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PieceworkExportError';
  }
}

const ADJUSTMENT_LABELS: Record<SalaryAdjustmentType, string> = {
  BONUS: '奖金',
  DEDUCTION: '扣款',
  CORRECTION: '差错修正',
};

function nextYmd(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

export async function loadPieceworkExportData(filter: PieceworkExportFilter) {
  const from = parseStrictYmd(filter.from);
  const to = parseStrictYmd(filter.to);
  if (!from || !to || from > to) {
    throw new PieceworkExportError('导出日期范围不合法');
  }
  if ((to.getTime() - from.getTime()) / 86_400_000 > 366) {
    throw new PieceworkExportError('单次最多导出 366 天');
  }
  const where: Prisma.DailyWorkerSalaryWhereInput = {
    date: { gte: from, lt: nextYmd(to) },
    ...(filter.workerId ? { workerId: filter.workerId } : {}),
  };
  return db.dailyWorkerSalary.findMany({
    where,
    orderBy: [{ date: 'asc' }, { worker: { displayName: 'asc' } }],
    include: {
      worker: { select: { displayName: true, username: true } },
      items: { orderBy: [{ completedAt: 'asc' }, { orderNo: 'asc' }] },
      adjustments: {
        orderBy: { createdAt: 'asc' },
        include: { createdBy: { select: { displayName: true } } },
      },
    },
  });
}

type CellValue = string | number | boolean | Date | null | undefined;

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cellXml(value: CellValue, row: number, column: number): string {
  const ref = `${xlsxColumnName(column)}${row}`;
  if (value === null || value === undefined) return `<c r="${ref}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="2"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function sheetXml(rows: CellValue[][]): string {
  const columnCount = Math.max(1, rows[0]?.length ?? 1);
  const columns = Array.from({ length: columnCount }, (_, column) => {
    const width = Math.min(
      36,
      Math.max(
        10,
        ...rows.slice(0, 500).map((row) => String(row[column] ?? '').length + 2),
      ),
    );
    return `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`;
  }).join('');
  const rowXml = rows
    .map((cells, index) => {
      const row = index + 1;
      const style = row === 1 ? ' s="1" customFormat="1"' : '';
      return `<row r="${row}"${style}>${cells
        .map((value, column) => cellXml(value, row, column))
        .join('')}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${xlsxColumnName(Math.max(0, (rows[0]?.length ?? 1) - 1))}${Math.max(1, rows.length)}"/></worksheet>`;
}

function dateYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateTimeShanghai(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function machineRuleAuditValues(snapshot: unknown) {
  const rule = snapshot as LegacyMachineRuleSnapshot;
  return {
    dailyBase: numericCell(rule.dailyBase),
    pieceRate: numericCell(rule.pieceRate),
    boardRate: numericCell(rule.boardRate),
    smallOrderThreshold: rule.smallOrderThreshold ?? '',
    smallOrderInclusive:
      rule.smallOrderThreshold === null ||
      rule.smallOrderThreshold === undefined
        ? ''
        : rule.smallOrderInclusive
          ? '是（≤）'
          : '否（<）',
    smallOrderFlatPrice: numericCell(rule.smallOrderFlatPrice),
    largeOrderSetupFee: numericCell(rule.largeOrderSetupFee ?? 0),
    multiplierFactors: (rule.multiplierFactors ?? []).join(','),
  };
}

export async function buildPieceworkWorkbook(
  salaries: Awaited<ReturnType<typeof loadPieceworkExportData>>,
): Promise<Buffer> {
  const summaryRows: CellValue[][] = [[
    '日期', '师傅', '账号', '保底机型', '任务数', '工单数', '计件合计',
    '每日保底', '人工调整', '实发金额', '发放状态', '发放时间',
  ]];
  const detailRows: CellValue[][] = [[
    '日期', '师傅', '工单号', '款式', '工艺', '机型', '良品数', '次品数',
    '返工数', '板数', '下数', '每日保底', '每下单价', '每板单价',
    '小单阈值', '阈值含等于', '小单固定金额', '大单装板费', '倍率',
    '计件金额', '完工时间', '任务ID',
  ]];
  const adjustmentRows: CellValue[][] = [[
    '日期', '师傅', '类型', '金额', '原因', '操作人', '操作时间',
  ]];

  for (const salary of salaries) {
    summaryRows.push([
      dateYmd(salary.date),
      salary.worker.displayName,
      salary.worker.username,
      MACHINE_TYPE_LABELS[salary.machineType],
      salary.taskCount,
      salary.orderCount,
      Number(salary.totalPieceworkAmount),
      Number(salary.baseSalary),
      Number(salary.adjustmentAmount),
      Number(salary.actualSalary),
      salary.isPaid ? '已发' : '未发',
      salary.paidAt ? dateTimeShanghai(salary.paidAt) : '',
    ]);
    for (const item of salary.items) {
      const rule = machineRuleAuditValues(item.salaryRuleSnapshot);
      detailRows.push([
        dateYmd(salary.date),
        salary.worker.displayName,
        item.orderNo,
        item.orderItemName,
        item.craftName,
        MACHINE_TYPE_LABELS[item.machineType as MachineType],
        item.completedQty,
        item.defectQty,
        item.reworkQty,
        item.boardCount,
        item.pressCount,
        rule.dailyBase,
        rule.pieceRate,
        rule.boardRate,
        rule.smallOrderThreshold,
        rule.smallOrderInclusive,
        rule.smallOrderFlatPrice,
        rule.largeOrderSetupFee,
        rule.multiplierFactors,
        Number(item.pieceworkAmount),
        dateTimeShanghai(item.completedAt),
        item.productionTaskId,
      ]);
    }
    for (const entry of salary.adjustments) {
      adjustmentRows.push([
        dateYmd(salary.date),
        salary.worker.displayName,
        ADJUSTMENT_LABELS[entry.type],
        Number(entry.amount),
        entry.reason,
        entry.createdBy.displayName,
        dateTimeShanghai(entry.createdAt),
      ]);
    }
  }

  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<Buffer>((resolve, reject) => {
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (error: Error) => output.destroy(error));
  archive.pipe(output);

  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`, { name: '[Content_Types].xml' });
  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`, { name: '_rels/.rels' });
  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="工资汇总" sheetId="1" r:id="rId1"/><sheet name="计件明细" sheetId="2" r:id="rId2"/><sheet name="人工调整" sheetId="3" r:id="rId3"/></sheets></workbook>`, { name: 'xl/workbook.xml' });
  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`, { name: 'xl/_rels/workbook.xml.rels' });
  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`, { name: 'xl/styles.xml' });
  archive.append(sheetXml(summaryRows), { name: 'xl/worksheets/sheet1.xml' });
  archive.append(sheetXml(detailRows), { name: 'xl/worksheets/sheet2.xml' });
  archive.append(sheetXml(adjustmentRows), { name: 'xl/worksheets/sheet3.xml' });
  await archive.finalize();
  return finished;
}

function numericCell(value: string | number | null | undefined): number | string {
  if (value === null || value === undefined || value === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value);
}
