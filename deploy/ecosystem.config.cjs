/**
 * Production process isolation: one web process, one concurrent light worker,
 * and one single-concurrency heavy worker for compression/browser workloads.
 */
const cwd = '/var/www/print-shop-erp'; // 按实际部署路径修改
const logs = '/var/log/print-shop-erp';
const common = {
  cwd,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 10,
  min_uptime: '60s',
  merge_logs: true,
  time: true,
  env: {
    NODE_ENV: 'production',
    BACKGROUND_JOBS_MODE: 'durable',
  },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'print-shop-erp',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      max_memory_restart: '768M',
      node_args: '--max-old-space-size=640',
      kill_timeout: 30_000,
      error_file: `${logs}/web-error.log`,
      out_file: `${logs}/web-out.log`,
    },
    {
      ...common,
      name: 'print-shop-erp-worker-light',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'scripts/background-worker.ts --queue=LIGHT',
      interpreter: 'node',
      max_memory_restart: '384M',
      node_args: '--max-old-space-size=320',
      kill_timeout: 60_000,
      error_file: `${logs}/worker-light-error.log`,
      out_file: `${logs}/worker-light-out.log`,
    },
    {
      ...common,
      name: 'print-shop-erp-worker-heavy',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'scripts/background-worker.ts --queue=HEAVY',
      interpreter: 'node',
      max_memory_restart: '1280M',
      node_args: '--max-old-space-size=1024',
      kill_timeout: 300_000,
      error_file: `${logs}/worker-heavy-error.log`,
      out_file: `${logs}/worker-heavy-out.log`,
    },
  ],
};
