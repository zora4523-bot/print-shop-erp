---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: local development and repository validation
---

# 故障排查

先保留原始错误、发生页面、时间和开发服务器终端输出。不要一看到错误就删除数据库、更新截图基线或清空整个工作区。

生产故障使用 [DEPLOYMENT.md](./DEPLOYMENT.md) 指向的 canonical runbook；本文主要处理本地开发和验证。

## `fetchServerAction: Failed to fetch`

### 含义

浏览器在调用 Next.js Server Action 时没有拿到 HTTP 响应。它是传输层症状，不等于 `EditAccountPage` 或某个业务 Action 已抛出 TypeError。常见原因包括：

- 开发服务器已退出、重启或正在重新编译；
- 页面持有旧 `.next/dev` 客户端 chunk，服务端已换构建；
- 3000 端口被另一个项目占用，浏览器连接到错误实例；
- 浏览器访问的 host/port 与实际开发服务器不一致；
- 代理、网络或浏览器扩展中断请求。

### 诊断顺序

```bash
node -v
pnpm -v
lsof -nP -iTCP:3000 -sTCP:LISTEN
curl -I http://localhost:3000/login
```

1. Node 应满足 `>=24`，pnpm 应为 `10.33.1`。
2. `lsof` 应只有预期项目的开发服务器。
3. 检查运行 `pnpm dev` 的终端，找编译错误、OOM、数据库断连或进程退出。
4. 服务正常后在错误页面做强制刷新，再重试一次。
5. 若仍使用旧 chunk，停止开发服务器，把 `.next` **移动到可恢复备份路径**后再启动：

   ```bash
   mv .next "/tmp/print-shop-erp-next-$(date +%Y%m%d-%H%M%S)"
   pnpm dev
   ```

不要在服务器运行期间清理 `.next`，也不要同时启动多个 `next dev`。

## 开发服务器无法启动

### `EADDRINUSE` / 端口占用

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

回到对应终端正常结束进程；终端丢失时，只对核实属于本项目的 PID 执行 `kill <PID>`。不要使用 `pkill node`，它会终止其他项目或工具。

### Node 或 pnpm 版本不匹配

```bash
node -v
pnpm -v
node -p "require('./package.json').engines.node"
node -p "require('./package.json').packageManager"
```

切换到 Node 24 后重新执行 `pnpm install --frozen-lockfile`。不要通过手改 lockfile 或移除 `engines` 绕过版本要求。

### 找不到生成的 Prisma 模块

```bash
pnpm exec prisma generate
pnpm typecheck
```

不要手改 `generated/prisma/` 或把业务导入切回 `@prisma/client`。

## Prisma 与数据库

### `DATABASE_URL is not set`

确认项目根 `.env` 存在且包含开发数据库连接。只检查变量名和目标，不要把连接串粘贴进 issue、聊天或日志。

```bash
pnpm exec prisma validate
pnpm exec prisma migrate status
```

### 数据库连不上

区分以下问题：PostgreSQL 未启动、host/port 错误、数据库不存在、账号无权限、TLS 证书不匹配。先用同一连接身份做最小连通检查，再运行 Prisma。不要为了让本地通过而放宽生产数据库权限。

### Migration 未应用或 schema 不一致

开发库应用仓库已有迁移：

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status
pnpm exec prisma generate
```

创建新 migration 使用 `pnpm db:migrate -- --name <name>`。不要对生产或共享库运行 `migrate reset` / `db push`，不要修改已应用 migration。失败恢复见 [DATABASE.md](./DATABASE.md) 和部署 runbook。

### Seed 后无法登录

当前 seed 没有固定默认密码。查看你刚刚执行 seed 的本地终端：未设置 `SEED_ADMIN_PASSWORD` 且首次创建管理员时，随机密码只打印一次。若数据库已有管理员，seed 可能按安全规则跳过或拒绝。完整分支见 [`prisma/seed.ts`](./prisma/seed.ts)；不要通过直接把普通用户提升为 ADMIN 来绕过。

## pnpm 与依赖

### `frozen-lockfile` 失败

说明 `package.json` 和 `pnpm-lock.yaml` 不一致。若本次任务没有授权升级依赖，先检查是否存在他人的未提交依赖改动，不要重新生成 lockfile 掩盖问题。确需升级时，在同一变更提交 package 和 lockfile，并运行构建与全量测试。

### Puppeteer / Chromium 找不到

本地或 CI：

```bash
pnpm test:e2e:install
pnpm exec playwright install chromium
```

生产使用系统 Chromium、PM2 环境和中文字体，按[部署指南](./docs/部署指南.md)排查。浏览器可启动不代表中文 PDF 正常，仍需实际打开 PDF 检查字形。

## E2E

### Playwright 等待 Web server 超时

- 确认 `E2E_BASE_URL` 是有效 URL，默认 `http://localhost:3000`。
- 查看该端口是否已经运行别的项目。
- 手工运行的服务与 Playwright 不要争用同一个 `.next`。
- CI 会启动自己的服务，本地默认复用已存在服务。

可以为隔离运行选择明确端口：

```bash
E2E_BASE_URL=http://127.0.0.1:3100 pnpm exec playwright test --project=chromium --workers=1
```

### E2E 数据冲突或偶发失败

Playwright 会写开发数据库且默认串行。确认没有另一套测试并发操作同一数据库；不要指向生产。保留失败 trace、截图和 fixture id，先重现根因，不通过增加任意等待或删除断言“修复”。

### 登录 fixture 失败

确认 E2E 使用的角色账号存在、处于 active，且测试凭证和本地 seed 一致。不要在测试代码中加入生产账号或固定生产密码。

## 视觉门禁

### 管理端或师傅端 overflow / axe 失败

先打开 `test-results/` 中对应截图和报告，定位实际元素：

- overflow：检查长中文、sticky inset、表格横滚、手机卡片和容器宽度；
- axe contrast：先确认明暗主题已稳定，检查 transition/reduced-motion 竞态，再检查 token；
- touch：确保窄屏主要操作达到可用触控尺寸；
- 不放宽门禁、不排除节点、不用延迟掩盖真实问题。

分别运行：

```bash
pnpm test:admin-ui
pnpm test:worker-ui
```

### 打印截图不一致

只有 `tests/visual/order-print.spec.ts` 使用像素基线。先确认：

- 测试 origin 与基线一致；二维码会编码 origin；
- 字体、Chromium 版本和操作系统与基线环境一致；
- 差异是否只在二维码/抗锯齿，还是实际布局变化。

未经设计确认不要运行 `pnpm test:visual:update`。更新基线必须作为可审查改动，说明每张变化的原因。

### “视觉测试通过”但页面仍不像设计稿

管理端和师傅端当前门禁验证六视口、明暗主题、溢出、触控和 axe，不执行设计稿像素 diff。通过门禁不能证明每个页面都按设计稿逐像素完成。按 [UI-SYSTEM.md](./UI-SYSTEM.md) 的设计证据等级和页面清单继续人工审查。

## TypeScript、lint 与构建

```bash
pnpm typecheck
pnpm lint
pnpm build
```

- 类型失败：修正真实输入/输出契约，不用 `as unknown as` 全局压过。
- 语义颜色 lint 失败：改用 `bg-warning/10`、`text-success` 等 token，不新增调色板字面量。
- build 成功但 dev 报错：停止并重启单一 dev server，必要时移动 `.next` 备份。
- dev 成功但 build 失败：检查 Server/Client 边界、动态 API、环境变量读取和静态生成路径；以 Next 16 本地文档为准。

## 外部服务

OSS 上传、企业微信通知、PDF、PM2 worker、cron、备份和 Nginx 都有环境差异。生产排查不要照搬本地 mock 结果，使用 [DEPLOYMENT.md](./DEPLOYMENT.md) 的资料地图和目标环境日志。

## 仍无法定位时

提交最小诊断信息：

- 精确命令和错误全文（删除 secret、连接串和用户数据）；
- Node / pnpm / Prisma 版本；
- 失败路径与角色；
- 开发服务器或测试 runner 的相关日志；
- 是否有未提交改动；
- 已执行的只读诊断和结果。

不要提交 `.env`、数据库 dump、Webhook URL、Bearer token、真实客户资料或共享密码。
