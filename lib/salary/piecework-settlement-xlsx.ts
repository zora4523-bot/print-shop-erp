import { ZipArchive } from 'archiver';
import { PassThrough } from 'node:stream';
import type { Prisma } from '../../generated/prisma/client';
import { parseStrictYmd } from '../auth/schemas';
import { db } from '../db';
import { xlsxCellXml, type XlsxCellValue } from '../export/xlsx-cell';
import { xlsxColumnName } from '../export/xlsx-column';

export type PieceworkSettlementExportFilter = {
  from: string;
  to: string;
  workerId?: string;
};

export class PieceworkSettlementExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PieceworkSettlementExportError';
  }
}

function nextYmd(date: Date): Date {
  return new Date(date.getTime() + 86_400_000);
}

export async function loadPieceworkSettlementExportData(
  filter: PieceworkSettlementExportFilter,
) {
  const from = parseStrictYmd(filter.from);
  const to = parseStrictYmd(filter.to);
  if (!from || !to || from > to) {
    throw new PieceworkSettlementExportError('导出日期范围不合法');
  }
  if ((to.getTime() - from.getTime()) / 86_400_000 > 365) {
    throw new PieceworkSettlementExportError('单次最多导出 366 天');
  }
  const where: Prisma.PieceworkSettlementWhereInput = {
    workDate: { gte: from, lt: nextYmd(to) },
    ...(filter.workerId ? { reporterId: filter.workerId } : {}),
  };
  return db.pieceworkSettlement.findMany({
    where,
    orderBy: [
      { workDate: 'asc' },
      { reporter: { displayName: 'asc' } },
      { id: 'asc' },
    ],
    select: {
      id: true,
      workDate: true,
      status: true,
      reportAmount: true,
      adjustmentAmount: true,
      payableAmount: true,
      lockedAt: true,
      paidAt: true,
      reporter: { select: { displayName: true, username: true } },
      items: {
        orderBy: [{ report: { reportedAt: 'asc' } }, { id: 'asc' }],
        select: {
          amount: true,
          report: {
            select: {
              snapshot: true,
              id: true,
              entryType: true,
              reportedCompletedQty: true,
              defectQty: true,
              reworkQty: true,
              chargeableQty: true,
              unit: true,
              rate: true,
              amount: true,
              priceBookVersion: true,
              ruleSetSha256: true,
              reportedAt: true,
              operation: {
                select: {
                  operationType: true,
                  order: { select: { orderNo: true, customName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

type CellValue = XlsxCellValue;

function sheetXml(rows: CellValue[][]): string {
  const columnCount = Math.max(1, rows[0]?.length ?? 1);
  const columns = Array.from({ length: columnCount }, (_, column) => {
    const width = Math.min(
      42,
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
        .map((value, column) => xlsxCellXml(value, row, column))
        .join('')}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${xlsxColumnName(Math.max(0, columnCount - 1))}${Math.max(1, rows.length)}"/></worksheet>`;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shanghaiDateTime(date: Date | null): string {
  if (!date) return '';
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

function payrollSource(snapshot: Prisma.JsonValue) {
  const payroll = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot.payroll : null;
  if (!payroll || typeof payroll !== 'object' || Array.isArray(payroll)) return { source: '统一工价', version: '' };
  return { source: payroll.rateSource === 'PERSONAL' ? '个人工价' : '统一工价', version: typeof payroll.policyBookVersion === 'number' ? payroll.policyBookVersion : '' };
}

export async function buildPieceworkSettlementWorkbook(
  settlements: Awaited<ReturnType<typeof loadPieceworkSettlementExportData>>,
): Promise<Buffer> {
  const summaryRows: CellValue[][] = [[
    '账本代次',
    '日期',
    '报工人',
    '账号',
    '报工条数',
    '报工金额',
    '调整',
    '应发',
    '状态',
    '锁定时间',
    '发放时间',
    '结算ID',
  ]];
  const detailRows: CellValue[][] = [[
    '账本代次',
    '日期',
    '报工人',
    '工单号',
    '工单名称',
    '工序类型',
    '条目类型',
    '合格完成数',
    '缺陷数',
    '返工数',
    '计薪数',
    '单位',
    '工价',
    '金额',
    '工价版本',
    '规则集Hash',
    '报工时间',
    '报工ID',
    '工价来源',
    '账号工价版本',
  ]];

  for (const settlement of settlements) {
    summaryRows.push([
      'PRODUCTION_REPORT',
      ymd(settlement.workDate),
      settlement.reporter.displayName,
      settlement.reporter.username,
      settlement.items.length,
      Number(settlement.reportAmount),
      Number(settlement.adjustmentAmount),
      Number(settlement.payableAmount),
      settlement.status === 'PAID' ? '已发放' : '已锁定',
      shanghaiDateTime(settlement.lockedAt),
      shanghaiDateTime(settlement.paidAt),
      settlement.id,
    ]);
    for (const { report } of settlement.items) {
      detailRows.push([
        'PRODUCTION_REPORT',
        ymd(settlement.workDate),
        settlement.reporter.displayName,
        report.operation.order.orderNo,
        report.operation.order.customName ?? '',
        report.operation.operationType,
        report.entryType === 'ADJUSTMENT' ? '人工调整' : report.entryType === 'REVERSAL' ? '冲正' : '报工',
        Number(report.reportedCompletedQty),
        Number(report.defectQty),
        Number(report.reworkQty),
        Number(report.chargeableQty),
        report.unit,
        Number(report.rate),
        Number(report.amount),
        report.priceBookVersion,
        report.ruleSetSha256,
        shanghaiDateTime(report.reportedAt),
        report.id,
        payrollSource(report.snapshot).source,
        payrollSource(report.snapshot).version,
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
  archive.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    { name: '[Content_Types].xml' },
  );
  archive.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    { name: '_rels/.rels' },
  );
  archive.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="新账本结算" sheetId="1" r:id="rId1"/><sheet name="新账本报工明细" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    { name: 'xl/workbook.xml' },
  );
  archive.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    { name: 'xl/_rels/workbook.xml.rels' },
  );
  archive.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    { name: 'xl/styles.xml' },
  );
  archive.append(sheetXml(summaryRows), {
    name: 'xl/worksheets/sheet1.xml',
  });
  archive.append(sheetXml(detailRows), {
    name: 'xl/worksheets/sheet2.xml',
  });
  await archive.finalize();
  return finished;
}
