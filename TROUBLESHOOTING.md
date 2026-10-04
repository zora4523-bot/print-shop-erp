---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
sections_verified: 2026-09-11 E2E isolation and release failure diagnosis
applies_to: local development and repository validation
---

# 故障排查

## 库存重放测试的开发调试通道（2026-09-27）

Next 16.3.4 为每次浏览器 Server Action 建立独立调试请求标识。测试把同一请求重复投递并丢弃第二个响应时，第二个响应不应复用 `x-nextjs-request-id` / `x-nextjs-html-request-id`，否则开发调试流可能重复结束并触发 `Cannot write to closing writable stream`。`tests/e2e/_action-replay.ts` 仅移除被丢弃响应的两项调试标识；保留 action、cookie、请求体和业务请求键，继续真实并发与单笔流水断言。不能吞掉 pageerror 或改业务去重逻辑掩盖传输问题。


## 采购/BOM 补资料后返回与重复提交（2026-09-27）

- 看到“继续上次录入”时，确认当前账号后续填；同一账号重新登录也需确认。不同标签页不会自动共享后续输入，复制标签页提示冲突时返回原页或明确另建。
- 显示“暂时无法确认是否已经创建”时可重新核对，也可继续原录入重试；沿用同一请求标识，不先清空存储或重复新建。已创建时打开原单据，内容变化先核对差异，再决定是否另建。
- 无法暂存时保留原标签页，在新标签页补资料后回原页点击“更新可选资料”。新标签页没有原录入属于预期，不能因此重填并重复创建。
- 排障只检查对应用户和表单的 `erp:form-draft:v1:` 键、授权创建记录与审计。不要删除 `FormCreationRequest` 来“允许重试”；数据库禁止改写该去重证据。暂存仅保留 24 小时、最多 8 份；过期、损坏或权限不再适用的内容不会自动恢复。

先保留原始错误、发生页面、时间和开发服务器终端输出。不要一看到错误就删除数据库、更新截图基线或清空整个工作区。

生产故障使用 [DEPLOYMENT.md](./DEPLOYMENT.md) 指向的 canonical runbook；本文主要处理本地开发和验证。

## Next.js 安装版本漂移导致首页 500

当日志出现 `unstable_catchError is not a function`，先比较
`package.json` 的 Next.js 版本和 `node -p "require('next/package.json').version"`。
当前仓库锁定 16.3.6，错误边界使用 `catchError` 和 `retry`。
旧版 16.2.4 分支使用 `unstable_catchError` 和 `unstable_retry`；
切换分支后应按目标分支锁文件安装依赖，不能只替换 API 或本地安装版本。

停止当前项目的开发服务器，将 `node_modules` 和 `.next` 移到仓库外备份，
执行 `pnpm install --frozen-lockfile`，再核对安装版本并启动服务。
仓库使用 `pnpm-lock.yaml` 和 pnpm 的 Prisma 适配器补丁配置，
不要混用没有对应锁文件的 `npm ci` 来恢复依赖。

验证时，未登录请求 `/` 应返回 307，跟随跳转到登录页后为 200。
故意抛错的页面可以返回 500，但浏览器必须显示“页面暂时无法加载”和重试按钮；
此时故障注入本身的异常日志是预期结果，不应再出现错误边界 API 加载失败。
临时故障路由验证完应移除，再检查正常访问日志。

## 工单详情脚本加载失败与费用请求结果未知（2026-09-29）

- `ChunkLoadError` 表示浏览器没有成功加载页面脚本。先保留错误 URL、发生时间及服务日志，再检查脚本状态码；仅凭错误页不能判定是代码缺陷、热更新、缓存或网络中断。后台错误页会提供“重新加载页面”，完整获取页面与资源；普通错误仍可先“重试当前页面”。刷新后恢复只证明当前能加载，不代表首次失败根因已定位。
- 工单附加费用和制版明细的保存／移除遇到连接失败时，页面显示“暂时无法确认费用处理结果”，保留输入并暂停本区继续提交。点击“在新标签页核对费用”检查最新费用记录、金额和历史状态；原标签页保留填写内容供对照。核对后再手动重新加载原页，重新加载会清除未保存输入。若记录已经生效，不要重新添加；若没有生效，重新加载后再填写提交。
- 这一恢复方式不自动重发收费请求，也不把未知结果当作失败或成功。业务校验失败仍可更正后提交；未识别的编程／权限／框架异常仍按原错误边界处理。费用的服务端权限、订单锁、价格版本校验和历史记录规则保持不变。
- `components/business/order/__tests__/CommercialFeeRecovery.browser.spec.tsx` 覆盖四类费用操作的连接失败、输入保留、互锁与六视口明暗主题；`tests/e2e/commercial-fee-recovery.spec.ts` 通过真实 Next 页面分别阻断发送、丢弃成功写入后的响应及阻断详情脚本，验证人工核对与完整刷新。写入测试必须使用经隔离预检的独立 E2E 数据库。

## `fetchServerAction: Failed to fetch`

建单发生此错误时，服务端可能已经保存。内容未改可直接重试；若提示“工单……已保存，本次填写与原记录不一致或无法核对”，按提示从列表打开原工单核对后修改，勿通过换提交标识反复新建。历史记录没有首次请求指纹时也会要求人工核对，避免误认保存成功。

批量建单最多 10 张。全部获得工单号后，结果页可“开始新一批”；刷新恢复的已保存工单即使上传或提交未完成也可进入下一批，后续到原工单详情继续。仍有未保存草稿时，先保存或移除该草稿。浏览器存储被禁用时，页内切换仍保留普通、寄样及打样内容，但关闭或刷新不能保证恢复；未上传文件刷新后需重新选择。

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

## 新建工单选了专版烫金，款名仍显示局部烫金

2026-09-24 局部核对：旧版管理员建单在切换工单类型时保留初始自动款名，费用明细直接引用款名，因此可能与已选工艺和报价组成不一致。应核对工单类型及具体收费项，不能仅凭款名认定实际采用了哪条价格规则。

以下修复记录只适用于已删除的内部建单表单（2026-09-24 起建单一律走外部销售表单），保留为历史：当时自动款名随类型、纸张、克重和规格选择更新，复制款保留“副本”后缀，手填名称保留。

2026-09-24 至 2026-09-26 之间，现行表单会按类型、纸张、克重和规格重新生成款名，管理员手填的名称会被覆盖。2026-09-26 起（业主决定，见 DECISIONS），“设计款名称”改由建单人填写，管理员与外部销售一致：单个设计款默认跟随工单名称，输入过名称即不再跟随（清空后在下次修改工单名称时恢复跟随；删到只剩一个未手动命名的设计款时也恢复跟随）；“＋ 增加设计款”的名称留空、须手动填写；同一设计款的规格共用名称；同一工单内不重名。切换类型、纸张、克重或规格不再改动已填名称。打印单上，混用多种纸张或克重的工单在每行款名下标出纸张与克重，只用一种纸张时看顶部“纸张类型”栏；XLSX 导出另有“克重”“类型”两列。打样仍用系统生成的名称，寄样品仍用“样品名称”。

2026-09-26 之前保存的本地草稿里是旧的自动款名，恢复后同一设计款各规格统一为第一行的名称，但不会改成工单名称；恢复草稿后请逐款核对设计款名称。未上传的图片和 CDR 文件在恢复草稿后需重新选择。已创建工单的历史名称不批量修改。上面“款名修复记录”只覆盖已删除的内部建单表单，不是现行规则的验证记录。

## 开发服务器无法启动

### 后台页面报 `Can't resolve 'proxy-agent'`

若导入链为 `ali-oss → urllib → detect_proxy_agent.js`，Turbopack 正在解析 OSS SDK 的可选代理模块。当前应用未启用 OSS 代理，Node.js 原生加载 SDK 不需要执行该分支。

保留 `next.config.ts` 中的 `serverExternalPackages: ['ali-oss']`，让服务端通过 Node.js 原生加载 OSS SDK。此配置依据当前安装版 Next.js 的 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`。若以后启用 `URLLIB_ENABLE_PROXY` 或显式代理，需另外安装并验证 SDK 兼容的代理依赖。

等待配置变更触发开发服务器重启，再刷新实际报错的已登录后台页面；只检查 `/login` 无法覆盖这条服务端导入链。运行 `pnpm exec vitest run lib/oss/__tests__` 验证 OSS 配置、签名与读取逻辑。

2026-09-11 验证：Next.js 16.3.4 下 `/owner` 已正常显示待办和经营数据，OSS 相关 38 个测试通过；本条验证不代表完成全量生产构建或真实 OSS 上传测试。

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

### 工单列表提示无法加载，日志出现 expired transaction

先保留耗时与错误，点击页面“重试”。`lib/order/admin-workspace.ts` 使用同一 `RepeatableRead` 事务读取列表、计数和金额，事务内的 `Promise.all` 仍共用一个数据库连接。报错提到某个聚合查询，不代表该查询独自耗尽时限。

该读取入口合并状态计数，并单独设置 15 秒事务时限。若仍超时，检查数据库锁等待、连接与查询耗时，再优化累计往返；不要把统计移出事务、用不完整合计降级，或全局提高写事务时限来掩盖问题。

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

### PDF 页面一直显示正在排队

在 `BACKGROUND_JOBS_MODE=durable` 下，Next.js 开发服务器不会消费 PDF 队列。先检查 `/api/health/jobs` 的 HEAVY worker 心跳，以及后台任务的状态、重试次数和错误；排队且从未启动时，优先确认消费进程是否运行。

本地缺少该进程时，在同一项目、同一开发环境启动：

```bash
pnpm worker:heavy
```

保留终端运行，任务完成后重新打开 PDF 链接。不要反复创建任务或直接修改任务状态。LIGHT worker 是独立进程，启动后可能发送已排队的通知，排查 PDF 时不需要启动它。生产进程管理使用部署 runbook。

## E2E

### Playwright 等待 Web server 超时

- 确认 `E2E_BASE_URL` 是受控本机独立端口，开发默认 `http://127.0.0.1:3100`，发布默认 `http://127.0.0.1:3200`；3000 和远程地址会被拒绝。
- 查看该端口是否已经运行别的项目。
- 手工运行的服务与 Playwright 不要争用同一个 `.next`。
- CI 和本地测试都会启动受控服务，不复用已有实例；端口被占用时先确认占用进程，不能直接连接未知服务。

先按 [测试环境约束](./DEVELOPMENT.md#测试环境约束) 配置独立 `E2E_DATABASE_URL`、匹配库名确认和测试账号，并完成迁移及测试工价前置。之后可以为开发模式选择明确端口：

```bash
E2E_BASE_URL=http://127.0.0.1:3100 pnpm exec playwright test --project=chromium --workers=1
```

### E2E 数据冲突或偶发失败

Playwright 只允许写入已确认的独立可丢弃 E2E 数据库，默认串行；缺少隔离前置会在启动服务或首次连接前失败。确认没有另一套测试并发操作同一测试库；不要指向日常开发库或生产。保留失败 trace、截图和 fixture id，以及已有追加式历史，先重现根因，不通过增加任意等待或删除断言“修复”。

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

工单每页只保留一个主二维码；在详情“版本与打印”中选择“打开打印版”，或使用“工单 PDF”下载。工序流转单已移除，旧 `mode=tasks` 链接不再生成文件。已印出的旧工序二维码继续按原岗位、版本校验，扫码本身不会记工资。

遇到 `PrintLayoutOverflowError` 或“打印内容超出 A4 页面”时，查看单条异常长文本、设计图及字体是否正常。系统会先按实际高度生成续页；仍无法安全分割时停止导出，不返回缺失内容的 PDF。修改内容或修复模板后重新生成，durable 模式还需重启 HEAVY worker 以加载新代码。

只有 `tests/visual/order-print.spec.ts` 使用像素基线。先确认：

- 测试 origin 与基线一致；二维码会编码 origin；
- 字体、Chromium 版本和操作系统与基线环境一致；
- 差异是否只在二维码/抗锯齿，还是实际布局变化。

未经设计确认不要运行 `pnpm test:visual:update`。更新基线必须作为可审查改动，说明每张变化的原因。

### “视觉测试通过”但页面仍不像设计稿

管理端和师傅端当前门禁验证九视口、明暗主题、溢出、触控和 axe，不执行设计稿像素 diff。通过门禁不能证明每个页面都按设计稿逐像素完成。按 [UI-SYSTEM.md](./UI-SYSTEM.md) 的设计证据等级和页面清单继续人工审查。

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

## 销售详情切换顺丰到付后整页无法加载

若日志出现 `Order_quoted_fee_snapshot_shape_check`，检查外部销售历史工单的报价更新顺序。
`quotedFee`、`quotedFeeCompleteness`、`quotedPricingRevisionId` 必须在每条 SQL 后满足
全空或全非空，不能先写金额再补引用。事务包裹本身不会延迟这个 CHECK。
正确顺序是更新共同费用事实、以新金额追加不可变价格修订，再一次写入完整报价三字段；
生产前与履约阶段的配送切换都必须遵守。保留已有约束及历史迁移，不用删约束或清空数据恢复。
事务失败会回滚；修复后刷新页面，再在没有待审批申请且版本有效时重试。非预期错误应在配送表单反馈。

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

## 发布复验发现的故障模式（2026-09-11 局部核对）

- **无 JavaScript 账单停在加载或原生提交不结束**：分别检查初始 HTML 是否被祖先 loading/Suspense 隐藏，以及提交后 `useActionState` 的绑定参数是否反复生成 pending Promise。本项目账单独立路由分组保留原授权布局，详情 action 在 Server Page 绑定后传给表单。应验证非法输入反馈与成功写入，不能以 action 已返回日志代替 HTTP 已完成。
- **访问详情就创建 PDF 后台任务**：下载动作使用原生链接；不能让 Next 导航预取触发生成接口。检查无点击时请求和任务数量均为零，点击一次只创建一次任务。
- **HEAVY 工单导出报 `server-only` 导入错误**：独立 worker 不能加载页面聚合模块。共享筛选条件维护在 `lib/order/admin-workspace-filters.ts`，页面与导出共同消费，避免复制权限/队列规则后产生分歧。
- **重复账号或启用 BOM 跳到整页错误**：检查 Prisma P2002 元数据中的带引号字段。只对已识别的字段集合转成业务反馈，未知约束继续抛出；不要笼统吞掉所有唯一冲突。

修复与真实复验边界见 [整改执行记录](./docs/audits/2026-09-11-remediation-validation.md)。测试环境与 CI 的现行运行方式见 [开发指南](./DEVELOPMENT.md#测试环境约束)。

- **登出后又变回已登录**：保留登出前后请求的顺序和 Set-Cookie 属性（不记录令牌内容），检查在途页面预取是否晚于登出响应回写会话。项目代理对预取仍鉴权，但不续写 Cookie；Next 16.3 需要保留 Proxy 的预取标头才能识别。不得只用新浏览器上下文掩盖原页面会话复活。

### PDF 字体、版本或重复下载失败

- 字体失败：校验 `public/fonts/print/manifest.json` 对应文件是否随发布包存在，网页字体请求是否成功；PDF 字体从磁盘内嵌，不通过 CDN 下载。不要删掉字体检查或改用系统字体绕过。
- `PDF_BROWSER_VERSION_MISMATCH`：核对 Web/HEAVY 的执行路径与已验收完整版本；升级浏览器需重跑打印测试并更新部署配置。
- 产物不可用：核对 Web/HEAVY 存储后端一致；多机必须共享卷或 OSS，不能各用 `/tmp`。产物 1 小时后过期，点击恢复链接重新生成；日志/页面不展示凭据或底层对象 URL。
- 队列持续 202：检查 HEAVY 心跳、重任务并发、失败次数、存储可写性；恢复既有 worker，不反复启动新 worker。

检查流程和未验收范围见 [跨设备打印](./docs/跨设备打印与可用性.md)。


## PDF 一直显示正在生成

启用 `BACKGROUND_JOBS_MODE=durable` 时，`pnpm dev` 只启动 Web 服务，
还需要独立运行 `pnpm worker:heavy`。检查 HEAVY worker 进程、日志和
`BackgroundWorkerHeartbeat.lastSeenAt`，并核对任务是否一直 PENDING、attempts 为 0。
本地可把 worker 日志单独保存到 `/tmp/erp-worker-heavy.log`；更新代码或依赖后也需重启 worker。

PDF 接口在账号和工单绑定校验通过后检查 HEAVY 心跳，使用与健康检查一致的有效窗口
和数据库时钟。无有效心跳返回 503；未完成任务自创建起等待达到两分钟也返回 503，
停止自动刷新。重试链接保留原 jobId，不取消任务、不重复入队；worker 恢复并完成后，
再次重试可正常取得 PDF。已成功的任务不受 worker 是否在线影响。

## 计件工价保存或发布失败

- “工价已被修改”：其他管理员保存或发布了同一版本；重新加载并核对，不强行覆盖。
- 生效时间不合法或早于上一版：选择晚于最新已发布版本的时间；未来已发布版本不能原地修改。
- 工价未发布/按盒缺价：管理员在员工工资规则页保存完整工价后发布，空值不能代替零。
- 保存草稿出现数据库约束错误：确认已应用 `20260916190000_piecework_draft_metadata`，保留错误日志供排查；不要关闭数据库保护。

调价不重算已有报工与历史工资。旧日薪仍是历史查询入口，不能用它恢复旧规则写入。

### 个人工价无法报工（2026-09-17）

管理员在用户管理的师傅账号中检查计件工价：草稿不生效，未来版本到时才生效，账号岗位变更后旧个人版本可能缺少新岗位单价。补齐新岗位个人价并发布，或发布“使用统一工价”版本；统一模式仍要求该岗位已有发布的统一价。不要直接改历史价格或工资。
“适用工价已调整”表示页面取价版本已过期，刷新核对后报工；原成功请求重试不会重复计薪。若不同账号不能分别建草稿，确认已应用 `20260917001000_personal_piecework_draft_scope`。

### 工单提成显示“需人工核定”，无法结算

适用于同工序多人接手、计价条件中途变化、继承生产进度或分档报工冲正。管理员进入工单详情 → 生产、用料与计件记录 → 工单提成明细，核对每人各工作日的目标提成，填写原因并保存核定。例如局部 2000 个、2 次过版合计 38 元，两人各做一半时可分别核定 19 元。已结算行不可改价；不得修改旧报工或数据库解除标记来绕过核定。账号工价调整只影响后续报工。

“分档烫金工序尚未结束”表示固定费可能还需分配给后续接手师傅。生产中批准修改申请升版时，旧版未完成的工序会自动取消，带分档报工的旧工序显示“需人工核定”，按上一段在工单提成明细核定即可结算。请在真实生产完成后完成工序；确实取消的工序按取消流程处理，再核对提成。不要为结算虚报完成。跨日冲正的负数行只读，填写核定原因后可保持原额确认；这不允许负净额工作日结算，也不修改历史报工或已结算工资。

## 2026-09-24 删除客服 / 清废厨师之后的常见提示

- **迁移 `20260924100000` / `20260924110000` 中止并报中文错误**（如“仍有 N 个账号的角色是客服”）：这是
  fail-closed 设计，迁移已整体回滚。不要改迁移或手工删数据；按 [部署指南](./docs/部署指南.md#删除客服--清废厨师的三条迁移2026-09-24)
  的只读预查定位命中的数据，交业主决定如何处理后再部署。
- **`/owner/pigsty` 报 `sensitive_policy_references_missing_columns`**：确认已应用
  `20260924150000_prune_removed_sensitive_column_policies`（删除指向已删列 / 表的 10 条脱敏策略）。
- **后台任务页的时薪月结 / 客服结算死信没有“重试”，或点重试提示“该任务类型对应的功能已停用”**：
  预期行为。这些功能已删除，记录只保留为运行历史，不要改任务状态让它重跑。
- **通知页已删除的客服周期通知不能“确认未送达并重发”**：预期行为，核对后选“确认已送达”或“忽略”收尾。
- **管理员保存寄样品 / 打样提示“请选择关联外部销售”**：在样品表单的「关联外部销售（必填）」中选择；
  下拉为空时先到账号管理创建或启用外部销售账号。
- **改数量 / 规格提示“外部销售工单的快递/耗材收费明细不完整”**：未提交的草稿不会再出现（只重算加工费，
  物流行在提交时生成）；已提交工单出现时，说明物流收费行缺失，需管理员补齐收费后再批准。
- **CDR 打包在 `OSS_PUBLIC_BASE_URL` 带路径前缀时失败**：前缀含空格编码或中文的情形已修复（前缀按编码态
  匹配再解码剩余 key）；仍失败时核对前缀是否与实际上传地址一致。

## 生产事实核对与恢复（2026-09-28）

重做未下发、数量申请被旧版取消、工资日期已结算或历史生产不明时，按 [生产事实恢复手册](docs/生产事实恢复手册.md) 先只读扫描，再逐单据证处理。不要通过换日期、改负责人、删除申请或解锁原账绕过守卫。

## PDF 服务未就绪（2026-09-30）

`PDF_WORKER_UNAVAILABLE` 表示 durable 路径没有近期 HEAVY 心跳，不能据此断言图稿损坏。开发使用 `pnpm dev` 启动完整依赖；若使用 `dev:web`，需单独管理 worker。管理员在后台任务页查看在线进程和失败记录，先检查 worker 启动日志，再运行 `pnpm check:pdf`。生产按部署指南使用同一账号、环境、Chromium 版本和共享存储检查，不能用改为 inline 绕过。

字体、浏览器版本、分页和存储错误分别按页面白名单错误码定位；不要把底层异常、签名图片 URL 或凭证粘贴到页面。用户可以进入“网页打印”，其权限和内容检查独立执行。`PDF_BROWSER_REUSE=0` 仅回退性能优化，不放宽任何生成验证或任务授权。

单张默认 direct 时不会因 HEAVY 离线返回 PDF_WORKER_UNAVAILABLE；看到该码应核对是否配置 queued 或仍在访问旧 jobId。PDF_BUSY 表示当前 Web 进程达到单张生成容量，稍后重试或使用网页打印，不要增加自动重试风暴。配置错误 PDF_CONFIGURATION_INVALID 需核对 PDF_ORDER_MODE=direct/queued。打印按钮现在打开 HTML 打印页；内嵌 PDF 查看器不可用时，仍可网页打印或下载后用系统查看器打开。直接模式不能生成时检查 Web 运行账号的 Chromium 和字体配置；生产排障不能关闭权限、内容或分页检查。

### PDF 局部故障

- `PDF_CONFIGURATION_INVALID`：核对生产 PDF_ORDER_MODE 显式为 direct/queued，queued 配合 durable；用候选目录的 `NODE_ENV=production node scripts/check-env.mjs` 检查。
- HEAVY 在线但后台任务页显示“PDF 暂不可用/状态未知”：检查 `/api/health/jobs` 的 pdf.ready；核对当前 APP_VERSION、Chromium、字体、共享产物存储与前向迁移。PDF 待处理任务保留，CDR/表格继续领取，不通过反复手动重试消耗预算。探针恢复后自动恢复领取；持续积压沿用既有 SLO。
- direct 失败通过响应 `X-Request-Id` 对应 `[pdf] failure`；日志仅含白名单分类，不要求提供 Cookie、客户地址、签名链接或原始堆栈。direct 没有后台任务行，后台任务列表不能用于判断 direct 请求是否发生。
- 图稿警告仍存在时检查图稿是否可读取，再重新生成；警告结果不会命中 direct 完成缓存。队列历史产物的保存规则不变。

### PDF 探针清理与短暂恢复

worker 的 OSS 探针在读写成功、仅删除失败时记录固定码 `[pdf-probe] cleanup-failed`，保持 PDF 能力；残留探针由 `private/order-pdf/` 生命周期规则回收。写入、读取或内容校验失败仍判不可用。`pnpm check:pdf` 和部署 smoke 继续严格要求清理成功。下载页暂时不可用时最多自动查询 120 秒，连续网络异常三次停止；批量打印连续异常满 120 秒后可用“刷新进度”重试原任务。
