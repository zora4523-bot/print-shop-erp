/**
 * PM2 进程配置示例（红包印刷 ERP）。
 *
 * 用法：
 *   1. 把本文件复制到服务器项目根目录，按需改 cwd / 端口 / 日志路径。
 *   2. `pm2 start deploy/ecosystem.config.cjs`
 *   3. `pm2 save && pm2 startup`（开机自启）
 *
 * 说明：
 *   - Next.js 用 `next start`（非 standalone），需完整 node_modules 在 cwd。
 *   - 环境变量由 Next 自动从项目根的 `.env` 读取（无需在这里重复列出），
 *     这里只固定 NODE_ENV=production —— 它决定推送/CDR 的 mock-mode 走真发。
 *   - MVP 单实例（fork）。JWT 无状态，将来要多实例横向扩展改 instances 即可，
 *     但 Puppeteer PDF 生成吃内存，先单实例观察。
 */
module.exports = {
  apps: [
    {
      name: 'print-shop-erp',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: '/var/www/print-shop-erp', // ← 改成你的实际部署路径
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '1G',
      // 日志落盘 + 轮转：配合 `pm2 install pm2-logrotate` 防无限增长
      error_file: '/var/log/print-shop-erp/error.log',
      out_file: '/var/log/print-shop-erp/out.log',
      merge_logs: true,
      time: true, // 每行日志加时间戳
      // 崩溃自动重启（默认开），但 1 分钟内连崩 10 次则停，避免刷屏
      max_restarts: 10,
      min_uptime: '60s',
    },
  ],
}
