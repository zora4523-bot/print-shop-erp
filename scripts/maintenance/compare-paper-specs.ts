import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { db as Database } from '../../lib/db';
import { postgresDatabaseIdentity } from '../lib/e2e-environment';
import { capturePaperSpecCompatibility, loadPaperComparisonReaders } from '../lib/capture-paper-spec-compatibility';
import { comparisonCasesSchema, comparePaperSpecCaptures, type PaperComparisonCapture } from '../lib/paper-spec-comparison';

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(
    ['mode', 'database-url', 'source-root', 'cases', 'at', 'out', 'before', 'after'].map((key) => [key, { type: 'string' as const }]),
  ) });
  const required = (key: string) => {
    const value = values[key];
    if (!value) throw new Error(`缺少 --${key}`);
    return value;
  };
  if (values.mode === 'compare') {
    const read = async (key: string) => JSON.parse(await readFile(required(key), 'utf8')) as PaperComparisonCapture;
    const differences = comparePaperSpecCaptures(await read('before'), await read('after'));
    process.stdout.write(`${JSON.stringify({ equal: differences.length === 0, differences })}\n`);
    if (differences.length) process.exitCode = 1;
    return;
  }
  if (values.mode !== 'capture') throw new Error('--mode 必须是 capture 或 compare');
  const databaseUrl = required('database-url');
  const identity = postgresDatabaseIdentity(databaseUrl);
  if (!identity) throw new Error('必须显式指定无目标覆盖参数的 PostgreSQL 连接串');
  const sourceRoot = resolve(required('source-root'));
  if (resolve(process.env.TSX_TSCONFIG_PATH ?? '') !== resolve(sourceRoot, 'tsconfig.json')) {
    throw new Error('须在进程启动前将 TSX_TSCONFIG_PATH 指向采集源 tsconfig.json，保证路径别名同源');
  }
  const at = new Date(required('at'));
  if (!Number.isFinite(at.getTime())) throw new Error('--at 必须是有效的 ISO 时间');
  const cases = comparisonCasesSchema.parse(JSON.parse(await readFile(required('cases'), 'utf8')));
  const out = required('out');
  const revision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['-C', sourceRoot, 'status', '--porcelain', '--', 'lib', 'generated', 'prisma'], { encoding: 'utf8' }).trim()) {
    throw new Error('采集源的 lib/generated/prisma 有未提交修改，不能作为确定版本基线');
  }
  process.env.DATABASE_URL = databaseUrl;
  const { db } = await import(pathToFileURL(resolve(sourceRoot, 'lib/db.ts')).href) as { db: typeof Database };
  try {
    const readers = await loadPaperComparisonReaders(sourceRoot);
    const capture = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const result = await capturePaperSpecCompatibility(tx, readers, cases, at, revision);
      if (result.provenance.database !== identity.databaseName) throw new Error('实际数据库与指定目标不一致');
      return result;
    }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
    await writeFile(out, `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ database: identity.databaseName, revision, cases: cases.length, out })}\n`);
  } finally { await db.$disconnect(); }
}

main().catch(() => {
  // Driver errors can embed credentials or SQL data; never echo them.
  process.stderr.write('纸张规格对比失败：请检查参数、源版本、用例覆盖和目标库；输出文件不可覆盖。\n');
  process.exitCode = 1;
});
