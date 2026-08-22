#!/usr/bin/env node

// Read-only production gate. It inspects `pgbackrest info --output=json`;
// it never creates, expires, restores, or deletes a backup.
import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== 'production');

const stanza = process.env.PGBACKREST_STANZA?.trim();
const maxAgeHours = positiveNumber(process.env.BACKUP_MAX_AGE_HOURS, 30);
const requiredRepos = positiveInteger(process.env.BACKUP_REQUIRED_REPOS, 2);
if (!stanza) fail('PGBACKREST_STANZA 未设，无法确定要验收的 pgBackRest stanza。');

const result = spawnSync(
  'pgbackrest',
  [`--stanza=${stanza}`, 'info', '--output=json'],
  { encoding: 'utf8', timeout: 30_000 },
);
if (result.error) {
  fail(`pgbackrest 无法执行：${result.error.message}`);
}
if (result.status !== 0) {
  fail(`pgbackrest info 失败（exit ${result.status}）。请在 Pigsty 节点检查 stanza/repository 配置。`);
}

let stanzas;
try {
  stanzas = JSON.parse(result.stdout);
} catch {
  fail('pgbackrest info 未返回有效 JSON。');
}
const info = Array.isArray(stanzas)
  ? stanzas.find((item) => item?.name === stanza) ?? stanzas[0]
  : null;
if (!info) fail(`未找到 stanza ${stanza} 的备份信息。`);

const errors = [];
const repos = Array.isArray(info.repo) ? info.repo : [];
const healthyRepos = repos.filter((repo) => Number(repo?.status?.code) === 0);
if (healthyRepos.length < requiredRepos) {
  errors.push(
    `健康 repository ${healthyRepos.length} 个，要求至少 ${requiredRepos} 个（本地 + 异地）`,
  );
}

const nowSeconds = Date.now() / 1_000;
const backups = Array.isArray(info.backup) ? info.backup : [];
for (const repo of healthyRepos) {
  const repoKey = Number(repo.key);
  const fulls = backups.filter(
    (backup) =>
      backup?.type === 'full' &&
      Number(backup?.database?.['repo-key'] ?? 1) === repoKey &&
      backup?.error !== true,
  );
  const latest = fulls.sort(
    (a, b) => Number(b?.timestamp?.stop ?? 0) - Number(a?.timestamp?.stop ?? 0),
  )[0];
  if (!latest) {
    errors.push(`repo${repoKey} 没有可用 full backup`);
    continue;
  }
  const ageHours = (nowSeconds - Number(latest.timestamp.stop)) / 3_600;
  if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) {
    errors.push(`repo${repoKey} 最新 full backup 已 ${ageHours.toFixed(1)} 小时，上限 ${maxAgeHours} 小时`);
  }

  const hasWal = (Array.isArray(info.archive) ? info.archive : []).some(
    (archive) =>
      Number(archive?.database?.['repo-key'] ?? 1) === repoKey &&
      typeof archive?.max === 'string' &&
      archive.max.length > 0,
  );
  if (!hasWal) errors.push(`repo${repoKey} 未观察到已归档 WAL`);
}

if (errors.length) {
  console.error('[backup-readiness] 失败');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `[backup-readiness] 通过：stanza=${stanza}, healthyRepos=${healthyRepos.length}, latestFull<=${maxAgeHours}h, WAL=present`,
);

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  return Math.floor(positiveNumber(value, fallback));
}

function fail(message) {
  console.error(`[backup-readiness] 失败：${message}`);
  process.exit(1);
}
