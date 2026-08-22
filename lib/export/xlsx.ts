import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  createWriteStream,
  type WriteStream,
} from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipArchive } from 'archiver';

const EXCEL_MAX_ROWS = 1_048_576;
const EXCEL_MAX_COLUMNS = 16_384;
const EXCEL_MAX_CELL_CHARACTERS = 32_767;
const EXCEL_MAX_SHEET_NAME_CHARACTERS = 31;
const XLSX_DECIMAL_KIND = 'xlsx-decimal';
const PLAIN_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type XlsxDecimal = Readonly<{
  kind: typeof XLSX_DECIMAL_KIND;
  value: string;
}>;

/**
 * Preserve an exact base-10 value for an XLSX numeric cell.
 *
 * Prisma Decimal and decimal.js instances can be passed directly. Their
 * toString() result must be ordinary decimal notation; callers whose decimal
 * library emits exponent notation must first use its toFixed() equivalent.
 */
export function xlsxDecimal(
  input: string | { toString(): string },
): XlsxDecimal {
  let value: string;
  try {
    value = typeof input === 'string' ? input : input.toString();
  } catch {
    throw new XlsxValidationError('精确十进制值无法转换为字符串');
  }
  if (typeof value !== 'string') {
    throw new XlsxValidationError('精确十进制值的 toString() 必须返回字符串');
  }
  validatePlainDecimal(value);
  return Object.freeze({ kind: XLSX_DECIMAL_KIND, value });
}

export type XlsxCellValue =
  | string
  | number
  | bigint
  | boolean
  | Date
  | XlsxDecimal
  | null
  | undefined;

export type XlsxRow = readonly XlsxCellValue[];
export type XlsxRows = Iterable<XlsxRow> | AsyncIterable<XlsxRow>;

export type XlsxSheet = {
  name: string;
  rows: XlsxRows;
  /** Excel column widths. Omit to let Excel use its default width. */
  columnWidths?: readonly number[];
};

export type WriteXlsxFileResult = {
  byteLength: number;
  sheetCount: number;
};

/**
 * Stream an XLSX workbook to an absolute path.
 *
 * Rows are consumed lazily and worksheet XML is fed directly into the ZIP
 * archive. The destination is replaced only after the complete archive has
 * closed successfully; failures leave an existing destination untouched and
 * remove the incomplete sibling temporary file.
 */
export async function writeXlsxFile(input: {
  filePath: string;
  sheets: readonly XlsxSheet[];
}): Promise<WriteXlsxFileResult> {
  validateFilePath(input.filePath);
  validateSheets(input.sheets);

  const directory = dirname(input.filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    directory,
    `.${basename(input.filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const worksheetStreams: Readable[] = [];
  let output: WriteStream | null = null;
  let outputDone: Promise<void> | null = null;

  try {
    output = createWriteStream(temporaryPath, {
      flags: 'wx',
      mode: 0o600,
    });
    outputDone = pipeline(archive, output);
    // Wait until the exclusive temporary file has actually been opened before
    // asking an async row source for data. This keeps the atomic-write
    // contract observable and surfaces path/permission failures before any
    // database cursor work begins.
    await once(output, 'open');

    appendWorkbookParts(archive, input.sheets);
    for (const [index, sheet] of input.sheets.entries()) {
      const worksheet = Readable.from(renderWorksheet(sheet), {
        encoding: 'utf8',
      });
      // archiver pipes an input stream through an internal PassThrough. Source
      // errors are not automatically forwarded across that pipe, so explicitly
      // destroy the archive to make pipeline() reject and trigger cleanup.
      worksheet.once('error', (error) => archive.destroy(error));
      worksheetStreams.push(worksheet);
      archive.append(worksheet, {
        name: `xl/worksheets/sheet${index + 1}.xml`,
      });
    }

    const archiveDone = archive.finalize();
    await Promise.all([archiveDone, outputDone]);
    const byteLength = archive.pointer();
    await rename(temporaryPath, input.filePath);
    return { byteLength, sheetCount: input.sheets.length };
  } catch (error) {
    for (const worksheet of worksheetStreams) worksheet.destroy();
    archive.abort();
    archive.destroy();
    output?.destroy();
    await outputDone?.catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function validateFilePath(filePath: string): void {
  if (!filePath || !isAbsolute(filePath)) {
    throw new XlsxValidationError('导出文件路径必须是绝对路径');
  }
}

function validateSheets(sheets: readonly XlsxSheet[]): void {
  if (sheets.length === 0) {
    throw new XlsxValidationError('XLSX 至少需要一个工作表');
  }
  const names = new Set<string>();
  for (const sheet of sheets) {
    validateSheetName(sheet.name);
    const normalized = sheet.name.normalize('NFKC').toLocaleLowerCase('en-US');
    if (names.has(normalized)) {
      throw new XlsxValidationError(`工作表名称重复：${sheet.name}`);
    }
    names.add(normalized);
    validateColumnWidths(sheet.name, sheet.columnWidths);
  }
}

function validateSheetName(name: string): void {
  const characterCount = Array.from(name).length;
  if (characterCount === 0 || name.trim().length === 0) {
    throw new XlsxValidationError('工作表名称不能为空');
  }
  if (characterCount > EXCEL_MAX_SHEET_NAME_CHARACTERS) {
    throw new XlsxValidationError(
      `工作表名称不能超过 ${EXCEL_MAX_SHEET_NAME_CHARACTERS} 个字符：${name}`,
    );
  }
  if (/[:\\/?*\[\]]/.test(name) || name.startsWith("'") || name.endsWith("'")) {
    throw new XlsxValidationError(`工作表名称包含 Excel 不允许的字符：${name}`);
  }
  if (stripInvalidXmlCharacters(name) !== name) {
    throw new XlsxValidationError(`工作表名称包含非法 XML 字符：${name}`);
  }
}

function validateColumnWidths(
  sheetName: string,
  widths: readonly number[] | undefined,
): void {
  if (!widths) return;
  if (widths.length > EXCEL_MAX_COLUMNS) {
    throw new XlsxValidationError(
      `工作表“${sheetName}”列宽数量超过 Excel 上限 ${EXCEL_MAX_COLUMNS}`,
    );
  }
  for (const width of widths) {
    if (!Number.isFinite(width) || width <= 0 || width > 255) {
      throw new XlsxValidationError(
        `工作表“${sheetName}”列宽必须在 0 到 255 之间`,
      );
    }
  }
}

function appendWorkbookParts(
  archive: ZipArchive,
  sheets: readonly XlsxSheet[],
): void {
  const worksheetOverrides = sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  archive.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${worksheetOverrides}</Types>`,
    { name: '[Content_Types].xml' },
  );
  archive.append(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    { name: '_rels/.rels' },
  );

  const workbookSheets = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');
  archive.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    { name: 'xl/workbook.xml' },
  );

  const worksheetRelationships = sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('');
  archive.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheetRelationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    { name: 'xl/_rels/workbook.xml.rels' },
  );
  archive.append(stylesXml(), { name: 'xl/styles.xml' });
}

async function* renderWorksheet(sheet: XlsxSheet): AsyncGenerator<string> {
  yield '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>';
  if (sheet.columnWidths?.length) {
    yield `<cols>${sheet.columnWidths
      .map(
        (width, index) =>
          `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
      )
      .join('')}</cols>`;
  }
  yield '<sheetData>';

  let rowNumber = 0;
  let maxColumnCount = 1;
  for await (const row of sheet.rows) {
    rowNumber += 1;
    if (rowNumber > EXCEL_MAX_ROWS) {
      throw new XlsxValidationError(
        `工作表“${sheet.name}”超过 Excel 行数上限 ${EXCEL_MAX_ROWS}`,
      );
    }
    if (!Array.isArray(row)) {
      throw new XlsxValidationError(
        `工作表“${sheet.name}”第 ${rowNumber} 行不是数组`,
      );
    }
    if (row.length > EXCEL_MAX_COLUMNS) {
      throw new XlsxValidationError(
        `工作表“${sheet.name}”第 ${rowNumber} 行超过 Excel 列数上限 ${EXCEL_MAX_COLUMNS}`,
      );
    }
    maxColumnCount = Math.max(maxColumnCount, row.length);
    const headerStyle = rowNumber === 1 ? ' s="1" customFormat="1"' : '';
    yield `<row r="${rowNumber}"${headerStyle}>${row
      .map((value, column) => cellXml(value, rowNumber, column, rowNumber === 1))
      .join('')}</row>`;
  }

  const lastRow = Math.max(1, rowNumber);
  const lastColumn = columnName(maxColumnCount - 1);
  yield `</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`;
}

function cellXml(
  value: XlsxCellValue,
  row: number,
  column: number,
  isHeader: boolean,
): string {
  const ref = `${columnName(column)}${row}`;
  const style = isHeader ? ' s="1"' : '';
  if (value === null || value === undefined) return `<c r="${ref}"${style}/>`;
  if (isXlsxDecimal(value)) {
    // Validate again at the serialization boundary so a structurally forged
    // object cannot inject XML or formula syntax without using xlsxDecimal().
    validatePlainDecimal(value.value);
    return `<c r="${ref}"${style}><v>${value.value}</v></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  let text: string;
  if (typeof value === 'string' || typeof value === 'bigint') {
    text = String(value);
  } else if (typeof value === 'number') {
    text = String(value);
  } else if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new XlsxValidationError(`单元格 ${ref} 包含无效日期`);
    }
    text = value.toISOString();
  } else {
    throw new XlsxValidationError(`单元格 ${ref} 包含不支持的值类型`);
  }
  if (text.length > EXCEL_MAX_CELL_CHARACTERS) {
    throw new XlsxValidationError(
      `单元格 ${ref} 超过 Excel 字符上限 ${EXCEL_MAX_CELL_CHARACTERS}`,
    );
  }
  // Strings are always inlineStr, including values beginning with =, +, - or
  // @. Excel therefore treats user-controlled content as text, never formulae.
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function isXlsxDecimal(value: unknown): value is XlsxDecimal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === XLSX_DECIMAL_KIND &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

function validatePlainDecimal(value: string): void {
  if (!PLAIN_DECIMAL_PATTERN.test(value)) {
    throw new XlsxValidationError(
      `精确十进制值必须使用普通数字格式（不允许指数、公式或特殊值）：${value}`,
    );
  }
}

function columnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function stripInvalidXmlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function xmlEscape(value: string): string {
  return stripInvalidXmlCharacters(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function stylesXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
}

export class XlsxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxValidationError';
  }
}
