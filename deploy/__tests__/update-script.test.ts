import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production deploy acceptance', () => {
  it('fails before releasing quiesce protection unless every release gate passes', async () => {
    const script = await readFile(resolve('deploy/update.sh'), 'utf8');

    expect(script).toContain("ss -H -ltn 'sport = :3000'");
    expect(script).toContain('listeners" != "127.0.0.1:3000"');
    expect(script).toContain('node scripts/deploy-jobs-gate.mjs --wait "$JOBS_HEALTH_URL"');
    expect(script).toContain('JOBS_HEALTH_URL');
    const preflight = script.indexOf('node scripts/deploy-jobs-gate.mjs --check-config "$JOBS_HEALTH_URL"');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(script.indexOf('\nDEPLOYMENT_QUIESCED=1'));
    expect(script).toContain('pm2 stop "$WEB_APP_NAME"');
    expect(script).toContain('pm2 stop "$LIGHT_WORKER_NAME"');
    expect(script).toContain('pm2 stop "$HEAVY_WORKER_NAME"');
    expect(script).not.toContain('该状态会自动重连，发布继续');
    expect(script).toMatch(
      /if \[ "\$ok" = "1" \]; then\s+assert_web_loopback_binding\s+assert_deploy_jobs_gate\s+DEPLOYMENT_QUIESCED=0/,
    );
  });
});

// L-15：发布必须把新 commit 作为 APP_VERSION 交给 PM2 启动的 Web 与 worker。
// 否则被 SIGKILL 的旧 worker 留下的新鲜心跳行和新进程版本字符串相同，
// 新 worker 启动即崩溃时 jobs 门禁仍会放行；换成新 SHA 后旧行只会触发
// version-mismatch，门禁拦住发布。
describe('deploy/update.sh release version', () => {
  const FULL_SHA = '0123456789abcdef0123456789abcdef01234567';

  it('exports the pulled commit as APP_VERSION to pm2 startOrReload --update-env', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'erp-update-sh-'));
    try {
      const bin = resolve(root, 'bin');
      const record = resolve(root, 'pm2-start-env');
      await mkdir(resolve(root, 'deploy'), { recursive: true });
      await mkdir(bin);
      await writeFile(
        resolve(root, 'deploy/update.sh'),
        await readFile(resolve('deploy/update.sh'), 'utf8'),
      );
      // Command stubs: no network, database, build or process manager access.
      const stubs: Record<string, string> = {
        git: [
          'case "$*" in',
          '  "rev-parse --short HEAD") echo 0123456 ;;',
          `  "rev-parse HEAD") echo ${FULL_SHA} ;;`,
          '  "pull --ff-only") ;;',
          '  *) echo "unexpected git $*" >&2; exit 97 ;;',
          'esac',
        ].join('\n'),
        pnpm: 'exit 0',
        node: 'exit 0',
        curl: 'exit 0',
        ss: 'echo "LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*"',
        pm2: [
          'case "$1" in',
          '  describe) exit 1 ;;',
          '  pid) echo 0 ;;',
          `  startOrReload) printf '%s|%s' "\${APP_VERSION-<unset>}" "$*" > '${record}' ;;`,
          '  *) ;;',
          'esac',
        ].join('\n'),
      };
      for (const [name, body] of Object.entries(stubs)) {
        await writeFile(resolve(bin, name), `#!/bin/sh\n${body}\n`);
        await chmod(resolve(bin, name), 0o755);
      }

      const result = await new Promise<{ code: number | null; stderr: string }>((done, reject) => {
        const child = spawn('bash', [resolve(root, 'deploy/update.sh')], {
          env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, NODE_ENV: 'test' },
          stdio: 'pipe',
        });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
        child.stdout.resume();
        child.once('error', reject);
        child.once('close', (code: number | null) => done({ code, stderr }));
      });

      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      expect(await readFile(record, 'utf8')).toBe(
        `${FULL_SHA}|startOrReload deploy/ecosystem.config.cjs --update-env`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
