// Pure read-only assessment of pgBackRest JSON. No credentials or backup operations.
export function assessBackupReadiness(stanzas, { stanza, maxAgeHours = 30, requiredRepos = 2, nowSeconds = Date.now() / 1000 }) {
  const errors = [];
  if (!stanza || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0 ||
      !Number.isInteger(requiredRepos) || requiredRepos < 1 || !Number.isFinite(nowSeconds)) {
    return ['Invalid backup gate configuration'];
  }
  const info = Array.isArray(stanzas) ? stanzas.find((item) => item?.name === stanza) : null;
  if (!info) return [`未找到 stanza ${stanza} 的备份信息`];
  if (info.status?.code !== 0) errors.push('stanza 状态异常');
  const repos = Array.isArray(info.repo) ? info.repo : [];
  const keys = new Set();
  const healthy = repos.filter((repo) => {
    if (!Number.isInteger(repo?.key) || repo.key < 1 || keys.has(repo.key)) {
      errors.push('repository 标识无效或重复');
      return false;
    }
    keys.add(repo.key);
    if (repo.status?.code !== 0) { errors.push(`repo${repo.key} 状态异常`); return false; }
    return true;
  });
  if (healthy.length < requiredRepos) errors.push(`健康 repository ${healthy.length} 个，要求至少 ${requiredRepos} 个（本地 + 异地）`);
  const backups = Array.isArray(info.backup) ? info.backup : [];
  const archives = Array.isArray(info.archive) ? info.archive : [];
  const databases = Array.isArray(info.db) ? info.db : [];
  for (const repo of healthy) {
    const ids = databases.filter((db) => db?.['repo-key'] === repo.key && Number.isInteger(db.id) && db.id > 0).map((db) => db.id);
    const databaseId = ids.length ? Math.max(...ids) : null;
    if (!databaseId) { errors.push(`repo${repo.key} 缺少当前数据库标识`); continue; }
    const fulls = backups.filter((backup) => backup?.type === 'full' && backup.error !== true &&
      backup.database?.['repo-key'] === repo.key && backup.database?.id === databaseId);
    const latest = fulls.sort((a, b) => Number(b.timestamp?.stop ?? 0) - Number(a.timestamp?.stop ?? 0))[0];
    if (!latest) { errors.push(`repo${repo.key} 没有当前数据库的可用 full backup`); continue; }
    const stop = latest.timestamp?.stop;
    const ageHours = (nowSeconds - stop) / 3600;
    if (!Number.isFinite(stop) || stop <= 0 || stop > nowSeconds + 60 || ageHours > maxAgeHours) {
      errors.push(`repo${repo.key} full backup 时间无效、超前或超过 ${maxAgeHours} 小时`);
    }
    const end = latest.archive?.stop;
    const wal = archives.find((archive) => archive?.database?.['repo-key'] === repo.key && archive.database?.id === databaseId);
    const segment = /^[0-9A-F]{24}$/;
    if (!segment.test(end ?? '') || !segment.test(wal?.min ?? '') || !segment.test(wal?.max ?? '') ||
        wal.min > end || wal.max < end) {
      errors.push(`repo${repo.key} 未观察到覆盖最新 full backup 终点的 WAL`);
    }
  }
  return errors;
}
