/**
 * Production process isolation: one web process, one concurrent light worker,
 * and one single-concurrency heavy worker for compression/browser workloads.
 */
const os = process.getBuiltinModule('node:os');

const cwd = '/var/www/print-shop-erp'; // 按实际部署路径修改
const logs = '/var/log/print-shop-erp';
const lowMemoryHost =
  process.env.ERP_LOW_MEMORY === '1' || os.totalmem() < 3 * 1024 ** 3;
const memory = lowMemoryHost
  ? {
      web: { restart: '512M', heap: 384 },
      light: { restart: '384M', heap: 256 },
      heavy: { restart: '640M', heap: 448 },
    }
  : {
      web: { restart: '768M', heap: 640 },
      light: { restart: '384M', heap: 320 },
      heavy: { restart: '1280M', heap: 1024 },
    };
const common = {
  cwd,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 1_000,
  min_uptime: '10s',
  exp_backoff_restart_delay: 1_000,
  merge_logs: true,
  time: true,
  env: {
    NODE_ENV: 'production',
    BACKGROUND_JOBS_MODE: 'durable',
    // Node only reads this CA bundle at process startup. Keeping it in the
    // PM2 environment makes PostgreSQL `sslmode=verify-full` survive reloads
    // and machine reboots; loading it from Next's .env would be too late.
    NODE_EXTRA_CA_CERTS:
      process.env.NODE_EXTRA_CA_CERTS ??
      '/usr/local/share/ca-certificates/pigsty-print-shop.crt',
    PUPPETEER_EXECUTABLE_PATH:
      process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium',
  },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'print-shop-erp',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      max_memory_restart: memory.web.restart,
      node_args: `--max-old-space-size=${memory.web.heap}`,
      kill_timeout: 30_000,
      error_file: `${logs}/web-error.log`,
      out_file: `${logs}/web-out.log`,
    },
    {
      ...common,
      name: 'print-shop-erp-worker-light',
      script: 'scripts/background-worker.ts',
      args: '--queue=LIGHT',
      interpreter: 'node',
      max_memory_restart: memory.light.restart,
      // `tsx` CLI 会再 spawn 一个实际 worker，导致 PM2/heap limit 只
      // 监控包装进程。Node --import 在同一 pid 内转译 TS。
      node_args: `--import tsx --max-old-space-size=${memory.light.heap}`,
      kill_timeout: 60_000,
      error_file: `${logs}/worker-light-error.log`,
      out_file: `${logs}/worker-light-out.log`,
    },
    {
      ...common,
      name: 'print-shop-erp-worker-heavy',
      script: 'scripts/background-worker.ts',
      args: '--queue=HEAVY',
      interpreter: 'node',
      max_memory_restart: memory.heavy.restart,
      node_args: `--import tsx --max-old-space-size=${memory.heavy.heap}`,
      kill_timeout: 300_000,
      error_file: `${logs}/worker-heavy-error.log`,
      out_file: `${logs}/worker-heavy-out.log`,
    },
  ],
};
