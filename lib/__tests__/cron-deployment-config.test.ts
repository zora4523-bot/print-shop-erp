import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const EXPECTED_ENDPOINTS = [
  'daily-salary',
  'generate-bills',
  'order-export-cleanup',
  'order-overdue',
  'outsource-overdue',
  'pending-factory-backlog',
  'production-alerts',
] as const;

describe('cron deployment configuration', () => {
  it('allowlists and schedules every protected cron endpoint', async () => {
    const [runner, crontab] = await Promise.all([
      readFile(resolve('deploy/run-cron.sh'), 'utf8'),
      readFile(resolve('deploy/crontab.example'), 'utf8'),
    ]);

    const allowlist = runner.match(
      /daily-salary\|[^)]+generate-bills/,
    )?.[0];
    expect(allowlist?.split('|').sort()).toEqual([...EXPECTED_ENDPOINTS].sort());

    const scheduled = Array.from(
      crontab.matchAll(/print-shop-erp-cron ([a-z-]+)$/gm),
      (match) => match[1],
    );
    expect(scheduled.sort()).toEqual([...EXPECTED_ENDPOINTS].sort());
  });

  it('从不把 Bearer 头放进 curl 的命令行参数', async () => {
    const runner = await readFile(resolve('deploy/run-cron.sh'), 'utf8');

    // 命令行参数对同机所有用户可见（ps -efww / /proc/PID/cmdline），
    // 密钥只能从 stdin 喂给 curl。
    expect(runner).not.toMatch(/--header\s+["']?Authorization/);
    expect(runner).toContain('--header @-');
    expect(runner).toMatch(/printf '%s\\n' "Authorization: Bearer \$secret"/);
  });

  it('前向迁移退役数据库 HTTP 调度并清理 GUC 密钥', async () => {
    const migration = await readFile(
      resolve(
        'prisma/migrations/20260822102000_retire_database_http_scheduler/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('cron.unschedule(scheduled_job_id)');
    expect(migration).toContain("command LIKE '%app.cron_secret%'");
    expect(migration).toContain("command LIKE '%/api/cron/%'");
    expect(migration).toContain('RESET app.cron_secret');
    expect(migration).toContain('settings.setdatabase = 0');
    expect(migration).toContain('ALTER ROLE %I RESET app.cron_secret');
    expect(migration).toContain('role scheduler settings remain after reset');
    expect(migration).toContain("false AS ready_to_schedule");
    expect(migration).toContain('NULL::text AS schedule_sql');
    expect(migration).toContain(
      '/usr/local/sbin/print-shop-erp-cron %s',
    );
    expect(migration).not.toMatch(/(?:^|\s)SET\s+app\.cron_secret/m);
  });

  it('在读取 secret 前拒绝非 loopback 的明文 HTTP URL', async () => {
    const result = await runCronWithUrl('http://erp.example.com');
    expect(result.code).toBe(65);
    expect(result.stderr).toContain('must be an origin-only https URL');
    expect(result.stderr).not.toContain('cron secret file must be');
  });

  it.each([
    'http://localhost.evil.example.com',
    'http://127.0.0.1.evil.example.com',
    'http://localhost:3000.evil.example.com',
    'https://erp.example.com/erp',
    'https://erp.example.com?tenant=print-shop',
    'https://erp.example.com/#cron',
    ' https://erp.example.com',
    'not a URL',
  ])('fail-closes deceptive, non-origin, or malformed URLs: %s', async (url) => {
    const result = await runCronWithUrl(url);
    expect(result.code).toBe(65);
    expect(result.stderr).toContain('must be an origin-only https URL');
    expect(result.stderr).not.toContain('cron secret file must be');
  });

  it.each([
    'http://localhost:3000@evil.example.com',
    'https://operator:password@evil.example.com',
  ])('拒绝可把目标主机藏在 userinfo 后面的 URL：%s', async (url) => {
    const result = await runCronWithUrl(url);
    expect(result.code).toBe(65);
    expect(result.stderr).toContain('must not contain URL credentials');
  });

  it.each([
    'https://erp.example.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('允许 TLS 或回环 URL：%s', async (url) => {
    const result = await runCronWithUrl(url);
    // 故意不给 secret 文件：走到这个错误说明 URL 守卫已放行。
    expect(result.code).toBe(66);
    expect(result.stderr).toContain('root-owned regular file with mode 0600');
  });

  it('rejects a secret file with group/other-readable permissions', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'erp-cron-secret-'));
    const secretFile = resolve(directory, 'secret');
    try {
      await writeFile(secretFile, 'do-not-send-this-secret\n', { mode: 0o644 });
      await chmod(secretFile, 0o644);

      const result = await runCronWithUrl('https://erp.example.com', secretFile);

      expect(result.code).toBe(66);
      expect(result.stderr).toContain('root-owned regular file with mode 0600');
      expect(result.stderr).not.toContain('do-not-send-this-secret');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses one descriptor for no-follow fstat and read instead of pathname check-then-read', async () => {
    const runner = await readFile(resolve('deploy/run-cron.sh'), 'utf8');

    expect(runner).toContain('O_NOFOLLOW | O_NONBLOCK');
    expect(runner).toContain('fs.fstatSync(fd)');
    expect(runner).toContain('stat.uid !== 0');
    expect(runner).toContain('(stat.mode & 0o777) !== 0o600');
    expect(runner).toContain('fs.readFileSync(fd, "utf8")');
  });
});

function runCronWithUrl(
  url: string,
  secretFile = '/definitely/missing/print-shop-erp-cron-secret',
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('sh', [resolve('deploy/run-cron.sh'), 'daily-salary'], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        APP_PUBLIC_URL: url,
        CRON_SECRET_FILE: secretFile,
      },
      stdio: 'pipe',
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('close', (code: number | null) => resolveRun({ code, stderr }));
  });
}

it('runs every cron line on Shanghai time', async () => {
  const cron = await readFile(resolve('deploy/crontab.example'), 'utf8');
  expect(cron).toMatch(/^CRON_TZ=Asia\/Shanghai$/m);
  expect(cron).not.toMatch(/cs-settle|cs-period-ending/);
});

it('keeps the deployment guide crontab template in sync with deploy/crontab.example', async () => {
  const [cron, guide] = await Promise.all([
    readFile(resolve('deploy/crontab.example'), 'utf8'),
    readFile(resolve('docs/部署指南.md'), 'utf8'),
  ]);
  const scheduleLines = (text: string) =>
    Array.from(
      text.matchAll(/^(\S+ \S+ \S+ \S+ \S+) \/usr\/local\/sbin\/print-shop-erp-cron ([a-z-]+)$/gm),
      (match) => `${match[1]} ${match[2]}`,
    ).sort();
  expect(scheduleLines(guide)).toEqual(scheduleLines(cron));
  expect(scheduleLines(cron)).toHaveLength(EXPECTED_ENDPOINTS.length);
});

it('runs bill generation after the Shanghai month boundary and no hourly payroll', async () => {
  const cron = await readFile(resolve('deploy/crontab.example'), 'utf8');
  expect(cron).not.toMatch(/hourly-payroll/);
  expect(cron).toMatch(/^40 0 1 \* \* .* generate-bills$/m);
});

it.each([
  [{ created: false, requeued: false }, 'skipped (duplicate scope)', 0],
  [{ created: true, requeued: false }, 'queued successfully', 0],
  [{ created: false, requeued: true }, 'queued successfully', 0],
  [{ status: 'queued' }, 'invalid enqueue response', 1],
])('classifies cron enqueue response %j', async (body, message, code) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'cron-response-'));
  try {
    const runner = await readFile(resolve('deploy/run-cron.sh'), 'utf8');
    const bodyFile = resolve(directory, 'body.json');
    await writeFile(bodyFile, JSON.stringify(body));
    // Execute the real response-handling shell; stub only syslog, with no HTTP/secret access.
    const script = 'logger() { printf "%s\\n" "$*"; }\nendpoint=test\nstatus=202\nbody_file="$1"\n' + runner.slice(runner.indexOf('if [ "$status" != "202" ]'));
    const scriptFile = resolve(directory, 'response.sh');
    await writeFile(scriptFile, script);
    const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn('sh', [scriptFile, bodyFile]);
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.once('error', reject);
      child.once('close', code => done({ code, output }));
    });
    expect(result.code).toBe(code);
    expect(result.output).toContain(message);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
