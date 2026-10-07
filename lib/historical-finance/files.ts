import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export async function readHistoricalFinanceFile(filename: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.(html|js|css|csv|md)$/.test(filename)) return null;
  const directory = process.env.HISTORICAL_FINANCE_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('Historical finance directory unavailable');
  let file;
  try {
    file = await open(path.join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await file.stat()).isFile()) return null;
    return { body: new Uint8Array(await file.readFile()), type: TYPES[path.extname(filename)]! };
  } catch (error) {
    if (error instanceof Error && 'code' in error && ['ENOENT', 'ELOOP'].includes(String(error.code))) return null;
    throw error;
  } finally {
    await file?.close();
  }
}
