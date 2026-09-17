#!/usr/bin/env node

// Read-only production gate. It inspects `pgbackrest info --output=json`;
// it never creates, expires, restores, or deletes a backup.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessBackupReadiness } from './lib/backup-readiness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== 'production');

const stanza = process.env.PGBACKREST_STANZA?.trim();
const maxAgeHours = positiveNumber(process.env.BACKUP_MAX_AGE_HOURS, 30);
const requiredRepos = positiveInteger(process.env.BACKUP_REQUIRED_REPOS, 2);
if (!stanza) fail('PGBACKREST_STANZA 未设，无法确定要验收的 pgBackRest stanza。');

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--info-file' || !args[1])) {
  fail('用法：check-backup-readiness.mjs [--info-file <pgBackRest JSON 快照>]');
}
let stdout;
if (args.length) {
  try { stdout = readFileSync(args[1], 'utf8'); } catch { fail('无法读取备份信息快照'); }
  console.log('[backup-readiness] 离线快照检查；不证明当前连接、归档延迟或恢复成功');
} else {
  const result = spawnSync('pgbackrest', [`--stanza=${stanza}`, 'info', '--output=json'],
    { encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) fail('pgBackRest info 执行失败，请检查主机配置');
  stdout = result.stdout;
}
let stanzas;
try { stanzas = JSON.parse(stdout); } catch { fail('pgBackRest 未返回有效 JSON'); }
const errors = assessBackupReadiness(stanzas, { stanza, maxAgeHours, requiredRepos });

if (errors.length) {
  console.error('[backup-readiness] 失败');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `[backup-readiness] 通过：stanza=${stanza}, requiredRepos=${requiredRepos}, latestFull<=${maxAgeHours}h, WAL covers latest backup; retention/continuous archiving/restore require separate verification`,
);

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  if (value === undefined || value === '') return fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) fail('备份门禁参数必须为正数');
  return parsed;
}

function positiveInteger(value, fallback) {
  const parsed = positiveNumber(value, fallback);
  if (!Number.isInteger(parsed)) fail('备份仓库数量必须为正整数');
  return parsed;
}

function fail(message) {
  console.error(`[backup-readiness] 失败：${message}`);
  process.exit(1);
}
