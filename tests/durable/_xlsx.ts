import { inflateRawSync } from 'node:zlib';

// Inspect the real OOXML archive with Node's ZIP primitives, matching the
// project's export verification without adding an Excel runtime dependency.
export function readWorkbookXml(file: Buffer): string {
  const entries = readZipEntries(file);
  if (!entries.has('xl/workbook.xml')) throw new Error('Download has no XLSX workbook');
  const sheets = [...entries].filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheets.length) throw new Error('Download has no XLSX worksheets');
  return sheets.map(([, xml]) => xml).join('\n');
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
