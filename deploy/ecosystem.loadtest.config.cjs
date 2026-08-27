/**
 * Isolated load-test processes for the retired 2C/2G application host.
 *
 * This deliberately uses different PM2 names, paths, and logs from the
 * preserved deployment in /var/www/print-shop-erp.
 */
const cwd = '/var/www/print-shop-erp-loadtest';
const logs = '/var/log/print-shop-erp-loadtest';

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
    TZ: 'Asia/Shanghai',
    PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium',
  },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'print-shop-erp-loadtest',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3000',
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      kill_timeout: 30_000,
      error_file: `${logs}/web-error.log`,
      out_file: `${logs}/web-out.log`,
    },
    {
      ...common,
      name: 'print-shop-erp-loadtest-worker-light',
      script: 'scripts/background-worker.ts',
      args: '--queue=LIGHT',
      interpreter: 'node',
      max_memory_restart: '384M',
      node_args:
        '--conditions=react-server --import tsx --max-old-space-size=256',
      kill_timeout: 60_000,
      error_file: `${logs}/worker-light-error.log`,
      out_file: `${logs}/worker-light-out.log`,
    },
    {
      ...common,
      name: 'print-shop-erp-loadtest-worker-heavy',
      script: 'scripts/background-worker.ts',
      args: '--queue=HEAVY',
      interpreter: 'node',
      max_memory_restart: '640M',
      node_args: '--import tsx --max-old-space-size=448',
      kill_timeout: 300_000,
      error_file: `${logs}/worker-heavy-error.log`,
      out_file: `${logs}/worker-heavy-out.log`,
    },
  ],
};
