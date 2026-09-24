# 印刷 ERP 压测方案与首轮结果

## 结论先行

这个项目需要压测，主要风险不是 28 人同时在线，而是 2 核 2GB 机器上的 Chromium PDF 渲染、PostgreSQL 轮询、工资大范围导出和后台队列竞争。

已完成本地首轮功能与工具验证，但本地数据只有 65 张工单，不能用来判定正式容量。正式压测必须在空闲测试服务器、独立测试数据库和测试 OSS 上运行；生产域名已被压测脚本硬性拒绝。

## 业务负载模型

| 负载 | 目标 |
| --- | ---: |
| 同时在线 | 28 人：销售 20、主管 3、师傅 5 |
| 旺季工单 | 500 张/天 |
| 高峰开单 | 25 张/小时 |
| 高峰报工 | 25 次/小时 |
| 历史工单 | 30,000 张 |
| PDF | 1,000 份/3 小时，约 333.33 份/小时，不同工单 |
| 典型 PDF 数据 | 平均 3 个款式，图片合计约 500KB，多图片/多页 |
| 工资导出 | 50 人 × 180 天，目标数据约 9,000 行 |

PDF 的平均到达间隔是 10.8 秒。单个 HEAVY worker 的平均处理时间必须小于 10.8 秒才不积压；保留 30% 余量时，目标是不高于 8.3 秒。

## 环境隔离建议

推荐拓扑：

1. 空闲 2 核 2GB 机器只运行 Web、LIGHT worker 和单个 HEAVY worker，与生产配置对齐。
2. PostgreSQL 使用另一个临时 2 核 2GB 实例，不与生产 PostgreSQL 共机、共库或共资源。
3. 使用独立测试 OSS bucket，建议配置 7 天生命周期清理；不读写生产 bucket。
4. `NOTIFICATION_MOCK_MODE=true` 和 `CDR_BUNDLE_MOCK_MODE=true`，禁止向真实企微群或外部协作方发送消息。
5. `BACKGROUND_JOBS_MODE=durable`，分别启动 LIGHT/HEAVY worker；HEAVY 并发先保持 1。
6. PDF 产物目录使用明确的绝对路径，Web 和 HEAVY worker 必须共享该路径。
7. 用 `NODE_ENV=production` 的生产构建运行，并设置非 `dev` 的 `APP_VERSION`，使 Web 和 worker 版本可核对。

如果暂时只有一台空闲 2 核 2GB 服务器，可以把 Web 和测试 PostgreSQL 同机用于功能与保守下界测试，但结果不能等同于“应用 2核 2GB + 独立数据库 2核 2GB”的正式容量。不建议在生产数据库实例中另建测试库后压测，因为 CPU、I/O、连接数和锁仍会影响生产。

## 需要准备的测试数据

- 脱敏后的 30,000 张历史工单，保留状态、日期、款式数、工艺数、任务和收货地址数量分布，替换姓名、手机、地址和备注。
- 1,000 张可打印的不同工单，每单平均 3 个款式，IMAGE 设计图合计至少 400KB，典型值约 500KB。图片应放在测试 OSS，尽量使用不同对象，避免缓存把结果变得过于乐观。
- 50 名测试师傅、180 天工资数据，目标约 9,000 行。
- 28 个独立账号，用户名统一以 `load-` 开头：销售 20、`ADMIN` 主管 3、`WORKER` 师傅 5。
- 测试开始前停止 cron 和非必要定时任务，或者把它们作为明确的混合负载纳入记录。

### 生成隔离库代表数据

`test:load:seed` 会生成一套幂等的合成数据：30,000 张三款三工艺工单、每单三个收货地址、1,000 张可真实加载约 500KB PNG 的可打印工单、生产任务以及 50 人 × 180 天的工资和任务明细。它还会生成正式基线所需的 28 个独立账号，不会把凭据打印到终端。

该脚本只接受名称含 `load` / `test` / `staging` / `perf` / `bench` 的数据库，并同时要求数据库和本次写入的精确确认值：

```bash
export DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/print_shop_erp_loadtest'
export LOAD_TEST_DB_ACK='isolated-test:127.0.0.1/print_shop_erp_loadtest'
export LOAD_TEST_SEED_ACK='seed-representative:127.0.0.1/print_shop_erp_loadtest:representative-v1'
export LOAD_TEST_INTERNAL_BASE_URL='http://127.0.0.1:3000'

pnpm test:load:seed --run-id representative-v1 \
  --credentials-output /var/lib/print-shop-erp-load/load-test-users.json
```

同一 `--run-id` 重跑会 upsert 同一批确定性 ID，不会把 30,000 张变成 60,000 张。为避免留下长期有效的弱凭据，每次运行会轮换 28 个登录密码，仅将明文写入指定 JSON 文件并强制 `chmod 600`；不要把该文件放入仓库。三张代表 PNG 默认生成到 `public/load-test/<run-id>/`，PDF worker 会通过内网 Web 地址真实拉取，而不是只伪造 `fileSize` 元数据。

## 压测前闸门

`test:load:preflight` 在只读事务中检查数据量、账号角色、工资范围、PDF 工单、队列 worker 和隔离配置。严格模式下任一条件不满足都会退出失败。

```bash
export LOAD_TEST_DB_ACK='isolated-test:<db-host>/<db-name>'
export LOAD_TEST_OSS_ACK='test-bucket:<test-bucket>'

pnpm test:load:preflight --strict \
  --output test-results/load/staging-preflight.json \
  --order-ids-output test-results/load/staging-pdf-order-ids.txt
```

这两个确认值不是密钥，而是防止误连数据库/对象存储的人工闸门。账号密码和真实密钥应只放在服务器环境变量中，不要发到聊天。

## 执行顺序

### 1. 单份 PDF 校准

先测 30 张：20 张典型工单、5 张图片数/大小 P95 工单、5 张多任务/多页/多地址工单。同时记录 Chromium PSS、整机 CPU、可用内存、swap、PM2 重启和数据库连接。

### 2. 28 人在线基线

先顺序登录预热 28 个会话，不把登录限流计入业务延迟。运行 15–30 分钟的页面查看/搜索基线，再加入 25 张/小时开单和 25 次/小时报工。

```bash
export LOAD_TEST_BASE_URL='https://<staging-host>'
export LOAD_TEST_REMOTE_ACK='staging:<staging-host>'

pnpm test:load read \
  --formal --preflight-report test-results/load/staging-preflight.json \
  --credentials-file /secure/path/load-test-users.json \
  --concurrency 28 --duration-seconds 1800 --think-ms 2000 \
  --p95-ms 2000 \
  --output test-results/load/staging-read-28.json
```

`load-test-users.json` 是 28 个 `{ "username": "...", "password": "..." }` 对象的 JSON 数组，文件必须 `chmod 600`。正式模式会根据登录后实际角色强制验证 20+3+5，并默认把销售/客服分配到 `/orders`、主管分配到 `/owner` 和 `/orders`、师傅分配到 `/worker`。登录会话会顺序预热，避免把登录限流混入业务指标。凭据文件不应放入仓库。

`read --smoke` 仍可用单个账号共享会话做快速路径验证，但报告会明确标记为无容量效力。开单/报工将使用现有 Playwright 业务流程，并在隔离账号和数据就绪后执行。

### 3. PDF 持续队列测试

```bash
export LOAD_TEST_MUTATION_ACK='mutate:<staging-host>'
export LOAD_TEST_USERNAME='<staging-account>'
export LOAD_TEST_PASSWORD='<set-in-shell-only>'

pnpm test:load pdf \
  --formal --preflight-report test-results/load/staging-preflight.json \
  --order-ids-file test-results/load/staging-pdf-order-ids.txt \
  --rate-per-hour 333.333333 --duration-seconds 10800 \
  --mean-ms 8300 --completion-timeout-ms 900000 \
  --output test-results/load/staging-pdf-1000-in-3h.json
```

每个 202 任务必须被跟踪到真正的 PDF 200 响应，并校验 `%PDF-` 文件头。不能只往队列塞任务，因为未下载产物会积累文件并扭曲结果。

### 4. 工资导出

```bash
pnpm test:load salary-export \
  --formal --preflight-report test-results/load/staging-preflight.json \
  --from <YYYY-MM-DD> --to <YYYY-MM-DD> \
  --concurrency 1 --p95-ms 10000 \
  --output test-results/load/staging-salary-50x180.json
```

再用 `--concurrency 4` 做短时重复点击测试。脚本同时校验 XLSX 内容类型和 ZIP 文件头，避免把登录页或错误 JSON 算成成功。

### 5. 峰值与恢复

单独测试 PDF 公网入口限流，不与 worker 容量混为一谈。当前 Nginx 单 IP 限制为约 10 次/分钟、burst 2；单台发压机同时发 50 个请求时，429 主要证明限流生效，不代表 PDF worker 容量。

在持续负载停止后，队列应能在可控时间内回到空闲，且不能遗留 `RUNNING`、`DEAD` 任务或临时 PDF 文件。

## 通过标准

- 普通页面/HTTP 请求 p95 ≤ 2 秒，p99 ≤ 4 秒，非预期错误率 < 1%；登录跳转、401/403/429 和错误页不计为成功。
- 开单和报工无丢失、无重复、无越权，工单/生产任务/工资不变式全部通过。
- PDF 实际完成 1,000/1,000，无 `DEAD`，重试率 < 1%，平均处理时间 ≤ 8.3 秒，队列积压不呈持续上升趋势。
- 工资导出 50 人 × 180 天的 p95 ≤ 10 秒，导出行数与金额校验一致。
- Web/worker 无 OOM、无 PM2 异常重启、无持续 swap 抖动；数据库无长时间锁等待，连接数保留安全余量。
- 正常持续场景不出现 429；专门的 burst 限流场景允许并应记录 429。

## 已完成的首轮结果

测试日期：2026-08-24。这些数据来自本地 Mac、`next start` 生产构建和小型本地数据库，只证明路径可执行，不是 2 核 2GB 容量结论。

| 场景 | 结果 | 局限 |
| --- | --- | --- |
| 生产构建 | `pnpm build` 通过 | 不含服务器负载 |
| 28 并发已登录读取，60 秒 | 807/807 成功，13.45 req/s；p95 506.77ms，p99 881.59ms | 只有 65 张工单，共享单会话，报告标记 `capacityAssessment.valid=false` |
| 工资导出，单次 | 35.57ms，XLSX 类型和文件头校验成功 | 仅 1 人、2 行工资 |
| 工资导出，4 并发 | 4/4 成功，p95 48.95ms | 数据量不具代表性 |
| PDF 完整响应 | 1/1 成功，2.39s，PDF 文件头校验成功 | inline 模式、小图片，不代表 durable 队列，报告标记无容量效力 |
| 本机纯 Chromium 校准 | 3 款、515,982 bytes；6 次平均 1.95s，p95 2.92s | Mac/纯内存，不含服务器、DB、OSS 网络 |

纯 Chromium 校准中进程树 RSS 求和约 1.0–1.1GiB（共享页可能被重复计算，不等于 PSS）。这已足以说明：在 2GB 机器上不应未经实测就把 HEAVY worker 并发调到 2。

## 远端执行状态

空闲服务器、隔离数据库、代表性数据和 28 个测试账号均已就绪，严格 preflight 已通过。2 核 2GB 远端实测结果见 [LOAD-TEST-RESULTS-2026-08-25.md](./LOAD-TEST-RESULTS-2026-08-25.md)。

当前剩余的拓扑差异是：PostgreSQL 与应用同机，PDF 图片来自本机静态路径，还没有真实的测试 OSS。因此这次结果是当前单机方案的实测结论，不是“独立数据库 + 真实 OSS”的最终容量证明。
