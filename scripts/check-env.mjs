#!/usr/bin/env node
/**
 * 生产环境变量预检 —— 启动/部署前跑，专抓上线审计发现的配置陷阱。
 *
 *   pnpm check:env            # 检查当前 .env（Next 已加载的 process.env）
 *   node scripts/check-env.mjs
 *
 * 退出码 0 = 通过；1 = 有 error（阻塞上线）。warning 不阻塞但会打印。
 *
 * 读取顺序：进程 env 优先，否则读项目根 .env（用 @next/env，与 next start
 * 加载口径一致）。故 CI/PM2 里注入的 env 也能被检查到。
 */
// @next/env 是 CommonJS，纯 .mjs 里用默认导入解构（具名导入 Node 会报错）。
import nextEnv from '@next/env';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, false); // dev=false → 按生产口径加载 .env / .env.production

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const errors = [];
const warnings = [];

const REQUIRED = [
  ['DATABASE_URL', '数据库连不上，应用起不来'],
  ['AUTH_SECRET', '会话签名密钥缺失，Auth.js 拒启'],
  ['CRON_SECRET', '9 个定时任务全部返回 503'],
];

for (const [key, why] of REQUIRED) {
  if (!env[key] || env[key].trim() === '') {
    errors.push(`${key} 未设置 —— ${why}`);
  }
}

// 反代场景必填
if (!env.AUTH_TRUST_HOST || env.AUTH_TRUST_HOST !== 'true') {
  warnings.push(
    'AUTH_TRUST_HOST 未设为 "true" —— Nginx 反代下登录跳转会失败（单机直连可忽略）',
  );
}

// —— 审计陷阱 1：NOTIFICATION_MOCK_MODE="true" 带进生产 → 推送静默 mock ——
if (isProd && env.NOTIFICATION_MOCK_MODE === 'true') {
  errors.push(
    'NOTIFICATION_MOCK_MODE="true" 且 NODE_ENV=production —— 企业微信推送会被静默 mock，' +
      '管理员以为在推实际一条不发。生产应留空（按 NODE_ENV 自动真发）。',
  );
}
if (isProd && env.CDR_BUNDLE_MOCK_MODE === 'true') {
  warnings.push(
    'CDR_BUNDLE_MOCK_MODE="true" 且 NODE_ENV=production —— CDR 汇总下载会返回 mock 占位链接。',
  );
}

if (isProd && env.BACKGROUND_JOBS_MODE === 'inline') {
  errors.push(
    'BACKGROUND_JOBS_MODE="inline" 且 NODE_ENV=production —— 通知/cron/CDR 会回到 Web 进程执行，丢失持久化、重试和资源隔离保障。',
  );
}

// —— 企业微信智能机器人：凭据必须成对，且长连接只能由 durable LIGHT worker 持有 ——
const WECOM_SMART_BOT_KEYS = ['WECOM_SMART_BOT_ID', 'WECOM_SMART_BOT_SECRET'];
const wecomSmartBotSet = WECOM_SMART_BOT_KEYS.filter(
  (key) => env[key] && env[key].trim() !== '',
);
if (wecomSmartBotSet.length === 1) {
  const missing = WECOM_SMART_BOT_KEYS.filter(
    (key) => !wecomSmartBotSet.includes(key),
  );
  errors.push(
    `企业微信智能机器人凭据只配了一部分（缺 ${missing.join(', ')}）—— ` +
      'WECOM_SMART_BOT_ID 与 WECOM_SMART_BOT_SECRET 必须成对配置或成对留空。',
  );
} else if (
  isProd &&
  wecomSmartBotSet.length === WECOM_SMART_BOT_KEYS.length &&
  env.BACKGROUND_JOBS_MODE !== 'durable'
) {
  errors.push(
    '生产已配置企业微信智能机器人，但 BACKGROUND_JOBS_MODE 不是 "durable" —— ' +
      'Bot ID + Secret 长连接只能由单个常驻 LIGHT worker 持有，不能回落到 Web/inline 执行。',
  );
}

if (isProd && !/^\d+\.\d+\.\d+\.\d+$/.test(env.PDF_CHROMIUM_VERSION || '')) {
  errors.push('生产 PDF_CHROMIUM_VERSION 必须固定为已验收 Chromium 的完整版本。');
}
const pdfStorage = env.PDF_ARTIFACT_STORAGE || 'filesystem';
if (!['filesystem', 'oss'].includes(pdfStorage)) errors.push('PDF_ARTIFACT_STORAGE 必须为 filesystem 或 oss。');
if (isProd && pdfStorage === 'filesystem' && !env.PDF_ARTIFACT_DIR?.trim()) {
  errors.push('生产 PDF_ARTIFACT_DIR 必须显式配置持久化共享目录。');
}
if (pdfStorage === 'oss') {
  for (const key of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_STS_ROLE_ARN', 'OSS_BUCKET', 'OSS_REGION']) {
    if (!env[key]?.trim()) errors.push(`PDF OSS 存储缺少 ${key}。`);
  }
}

for (const key of [
  'PDF_ARTIFACT_DIR',
  'ORDER_EXPORT_ARTIFACT_DIR',
  'AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR',
]) {
  if (key === 'PDF_ARTIFACT_DIR' && pdfStorage === 'oss') continue;
  const value = env[key]?.trim();
  if (value && !isAbsolute(value)) {
    errors.push(`${key} 必须是绝对路径 —— Web 与 HEAVY worker 需要访问同一个产物目录。`);
  } else if (isProd && !value) {
    warnings.push(
      `${key} 未显式配置 —— 将回退到系统临时目录；单机可用，但重启清理或多机部署会使待下载产物丢失。`,
    );
  }
}

// —— 审计陷阱 2：APP_PUBLIC_URL 空 → 二维码/短链跟随请求头，易成死链 ——
if (isProd && (!env.APP_PUBLIC_URL || env.APP_PUBLIC_URL.trim() === '')) {
  warnings.push(
    'APP_PUBLIC_URL 未设 —— 打印单二维码/CDR 外协短链的域名从请求头推导，' +
      'split-origin 或 Nginx 漏传 X-Forwarded-Proto 时会生成死链。强烈建议显式配公网根 URL。',
  );
} else if (env.APP_PUBLIC_URL && env.APP_PUBLIC_URL.endsWith('/')) {
  warnings.push('APP_PUBLIC_URL 末尾带斜线 —— 应去掉尾斜线（避免 // 拼接）。');
}
if (env.APP_PUBLIC_URL && isProd && !isSecureOrLoopbackOrigin(env.APP_PUBLIC_URL)) {
  errors.push(
    'APP_PUBLIC_URL 必须是不带路径、查询或片段的 https origin；只有 localhost / 127.0.0.1 / [::1] 回环地址允许 http。' +
      '否则 deploy/run-cron.sh 会通过明文网络发送 CRON_SECRET。',
  );
}

// —— OSS：5 个变量要么全配、要么全空（半配会让上传行为不一致）——
const OSS_KEYS = [
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_STS_ROLE_ARN',
  'OSS_BUCKET',
  'OSS_REGION',
];
const ossSet = OSS_KEYS.filter((k) => env[k] && env[k].trim() !== '');
if (ossSet.length > 0 && ossSet.length < OSS_KEYS.length) {
  const missing = OSS_KEYS.filter((k) => !ossSet.includes(k));
  errors.push(
    `OSS 变量只配了一部分（缺 ${missing.join(', ')}）—— 设计图/CDR 直传会 not-configured。` +
      '要么 5 个全配、要么全留空。',
  );
} else if (ossSet.length === 0) {
  warnings.push(
    'OSS 未配置 —— 设计图上传按钮会 disabled、CDR 打包走 mock。如需上传功能请配齐 5 个 OSS_* 变量 + bucket CORS。',
  );
}

// —— Sentry：生产建议但不阻塞 ——
if (isProd && (!env.SENTRY_DSN || env.SENTRY_DSN.trim() === '')) {
  warnings.push('SENTRY_DSN 未设 —— 生产无错误监控，上线首周建议接。');
}
if (isProd && (!env.APP_VERSION || env.APP_VERSION.trim() === '')) {
  warnings.push('APP_VERSION 未设 —— 无法把错误、健康检查和部署版本对齐。');
}

// —— NODE_ENV 提示 ——
if (!isProd) {
  warnings.push(
    `NODE_ENV=${env.NODE_ENV ?? '(未设)'} —— 若这是生产环境，推送/CDR 会走 mock。` +
      'PM2 ecosystem 已设 NODE_ENV=production；直接 next start 也会自动置 production。',
  );
}

// ── 输出 ──
console.log('\n[check-env] 环境变量预检\n');
if (warnings.length) {
  console.log('⚠️  警告（不阻塞，但请确认）：');
  for (const w of warnings) console.log('   - ' + w);
  console.log('');
}
if (errors.length) {
  console.log('❌ 错误（必须修复才能上线）：');
  for (const e of errors) console.log('   - ' + e);
  console.log('');
  console.log(`[check-env] 失败：${errors.length} 个错误。`);
  process.exit(1);
}
console.log(`[check-env] 通过。（${warnings.length} 条警告供确认）\n`);
process.exit(0);

function isSecureOrLoopbackOrigin(value) {
  try {
    if (value !== value.trim()) return false;
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.pathname !== '/' || url.search || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
