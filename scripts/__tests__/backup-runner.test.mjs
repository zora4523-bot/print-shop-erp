import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
function run(repo, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-backup-test-'));
  try {
    for (const [name, body] of Object.entries({
      id: 'echo "${TEST_USER:-postgres}"',
      psql: 'echo "${TEST_RECOVERY:-f}"; exit "${TEST_PSQL_EXIT:-0}"',
      pgbackrest: 'printf "%s\\n" "$@"; exit "${TEST_BACKUP_EXIT:-0}"',
    })) writeFileSync(join(dir, name), '#!/bin/sh\n'+body+'\n', { mode: 0o700 });
    return spawnSync('/bin/bash', [resolve('deploy/backup/run-full-backup.sh'), repo], {
      encoding: 'utf8', env: { PATH: dir, PGBACKREST_STANZA: 'pg-meta', ...overrides },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('targets each repository explicitly', () => {
  for (const repo of ['1', '2']) { const r = run(repo); assert.equal(r.status, 0); assert.match(r.stdout, new RegExp('--repo='+repo)); assert.match(r.stdout, /--type=full/); }
});
test('rejects invalid repo/stanza/user and standby', () => {
  for (const [repo, env] of [['3', {}], ['1', { PGBACKREST_STANZA: '' }], ['1', { PGBACKREST_STANZA: 'bad stanza' }], ['1', { TEST_USER: 'root' }], ['1', { TEST_RECOVERY: 't' }], ['1', { TEST_PSQL_EXIT: '1' }]]) {
    const r = run(repo, env); assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /--type=full/);
  }
});
test('propagates actual backup failure to systemd', () => assert.equal(run('2', { TEST_BACKUP_EXIT: '42' }).status, 42));
