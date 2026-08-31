import { inflateRawSync } from 'node:zlib';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  XlsxValidationError,
  writeXlsxFile,
  xlsxDecimal,
  type XlsxRow,
} from '../xlsx';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('writeXlsxFile', () => {
  it('streams multiple Chinese worksheets with frozen headers and safe inline strings', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, '工单导出.xlsx');

    async function* shipmentRows(): AsyncGenerator<XlsxRow> {
      yield ['工单号', '收货人'];
      await Promise.resolve();
      yield ['GD-260807-001', '张三'];
      yield ['GD-260807-002', '李四'];
    }

    const result = await writeXlsxFile({
      filePath,
      sheets: [
        {
          name: '工单&款式',
          columnWidths: [18, 22, 12],
          rows: [
            ['工单号', '备注', '金额'],
            ['GD-260807-001', '=SUM(A1:A2)', 12.5],
            ['GD-260807-002', `A&B<"'>\u0001`, '-12.5'],
          ],
        },
        { name: '发货明细', rows: shipmentRows() },
      ],
    });

    const file = await readFile(filePath);
    const entries = readZipEntries(file);
    const workbook = requiredEntry(entries, 'xl/workbook.xml');
    const orderSheet = requiredEntry(entries, 'xl/worksheets/sheet1.xml');
    const shipmentSheet = requiredEntry(entries, 'xl/worksheets/sheet2.xml');

    expect(result).toEqual({
      byteLength: (await stat(filePath)).size,
      sheetCount: 2,
    });
    expect(file.subarray(0, 2).toString()).toBe('PK');
    expect(workbook).toContain('name="工单&amp;款式"');
    expect(workbook).toContain('name="发货明细"');
    expect(orderSheet).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
    expect(orderSheet).toContain('<autoFilter ref="A1:C3"/>');
    expect(shipmentSheet).toContain('<autoFilter ref="A1:B3"/>');
    expect(orderSheet).toContain(
      '<t xml:space="preserve">=SUM(A1:A2)</t>',
    );
    expect(orderSheet).not.toContain('<f>');
    expect(orderSheet).toContain('<v>12.5</v>');
    expect(orderSheet).toContain(
      '<t xml:space="preserve">A&amp;B&lt;&quot;&apos;&gt;</t>',
    );
    expect(orderSheet).not.toContain('\u0001');
    expect(orderSheet).toContain(
      '<t xml:space="preserve">-12.5</t>',
    );
  });

  it('consumes an async row source lazily while the sibling temporary file exists', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'streamed.xlsx');
    let sawTemporaryOutput = false;

    async function* rows(): AsyncGenerator<XlsxRow> {
      yield ['index', 'value'];
      await new Promise<void>((resolve) => setImmediate(resolve));
      const entries = await readdir(directory);
      sawTemporaryOutput = entries.some((entry) => entry.endsWith('.tmp'));
      for (let index = 0; index < 5_000; index += 1) {
        yield [index, `row-${index}`];
      }
    }

    await writeXlsxFile({
      filePath,
      sheets: [{ name: '流式数据', rows: rows() }],
    });

    expect(sawTemporaryOutput).toBe(true);
    expect((await stat(filePath)).size).toBeGreaterThan(10_000);
    expect(await readdir(directory)).toEqual(['streamed.xlsx']);
  }, 15_000);

  it('writes exact decimal cells without converting through JavaScript Number', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'exact-decimals.xlsx');
    const decimalObject = {
      toString: () => '0.0100',
    };

    await writeXlsxFile({
      filePath,
      sheets: [
        {
          name: '金额',
          rows: [
            ['超长精确金额', '保留尾零', '负数'],
            [
              xlsxDecimal('12345678901234567890.123400'),
              xlsxDecimal(decimalObject),
              xlsxDecimal('-9999999999999999.99'),
            ],
          ],
        },
      ],
    });

    const worksheet = requiredEntry(
      readZipEntries(await readFile(filePath)),
      'xl/worksheets/sheet1.xml',
    );
    expect(worksheet).toContain('<v>12345678901234567890.123400</v>');
    expect(worksheet).toContain('<v>0.0100</v>');
    expect(worksheet).toContain('<v>-9999999999999999.99</v>');
    expect(worksheet).not.toContain('1.2345678901234567e+19');
  });

  it.each([
    'NaN',
    'Infinity',
    '-Infinity',
    '1e3',
    '1E-3',
    '=1+1',
    '+12.50',
    '@SUM(A1)',
    '-SUM(A1)',
    ' 12.50',
    '12.50 ',
    '.50',
    '1.',
    '01.50',
  ])('rejects non-plain exact decimal input %s', (value) => {
    expect(() => xlsxDecimal(value)).toThrow(
      '精确十进制值必须使用普通数字格式',
    );
  });

  it('rejects a decimal-like object whose toString contract is malformed', () => {
    expect(() =>
      xlsxDecimal({ toString: () => 12.5 as unknown as string }),
    ).toThrow('toString() 必须返回字符串');
  });

  it('keeps an existing destination intact and removes temporary files when rows fail', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'atomic.xlsx');
    await writeFile(filePath, 'previous-complete-file');

    async function* failingRows(): AsyncGenerator<XlsxRow> {
      yield ['工单号'];
      yield ['GD-260807-001'];
      throw new Error('database cursor failed');
    }

    await expect(
      writeXlsxFile({
        filePath,
        sheets: [{ name: '工单', rows: failingRows() }],
      }),
    ).rejects.toThrow('database cursor failed');

    await expect(readFile(filePath, 'utf8')).resolves.toBe(
      'previous-complete-file',
    );
    expect(await readdir(directory)).toEqual(['atomic.xlsx']);
  });

  it('rejects relative paths and invalid or duplicate worksheet names before writing', async () => {
    await expect(
      writeXlsxFile({
        filePath: 'relative.xlsx',
        sheets: [{ name: '工单', rows: [] }],
      }),
    ).rejects.toThrow(new XlsxValidationError('导出文件路径必须是绝对路径'));

    const directory = await temporaryDirectory();
    await expect(
      writeXlsxFile({
        filePath: join(directory, 'invalid.xlsx'),
        sheets: [
          { name: 'Orders', rows: [] },
          { name: 'Ｏｒｄｅｒｓ', rows: [] },
        ],
      }),
    ).rejects.toThrow('工作表名称重复');
    expect(await readdir(directory)).toEqual([]);

    await expect(
      writeXlsxFile({
        filePath: join(directory, 'invalid-name.xlsx'),
        sheets: [{ name: '工单/明细', rows: [] }],
      }),
    ).rejects.toThrow('Excel 不允许的字符');
    expect(await readdir(directory)).toEqual([]);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'print-shop-xlsx-'));
  temporaryDirectories.push(directory);
  return directory;
}

function requiredEntry(entries: Map<string, string>, name: string): string {
  const value = entries.get(name);
  if (value === undefined) throw new Error(`missing ZIP entry: ${name}`);
  return value;
}

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
