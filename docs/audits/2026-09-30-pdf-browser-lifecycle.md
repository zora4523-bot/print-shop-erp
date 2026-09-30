# PDF 浏览器生命周期修复（D1 / T1 / B2）实测记录

> Claude 第一批实现的历史交接记录，保留其原始范围与测量值。后续 T2/T3/T5/I3 实现、真实 Next + PM2 演练及带数据库的完整复跑见 [后续验证](2026-09-30-pdf-remediation-verification.md)；本文的未完成项不代表当前本地状态。

- 日期：2026-09-30；基线 `85b35491`（候选 `a494c4f5` + 方案文档）。
- 范围：[复审方案](2026-09-30-pdf-adversarial-review-plan.md) 中的 D1、T1（D2/D3），以及第二轮复审补充的 B2。T2、T3、D4、I3 未实施，生产容量未验收。
- 本机环境：macOS、Chromium 152.0.7977.75（Puppeteer 25.10.0 缓存）。以下数字不代表 1.6 GiB 生产主机的性能。

## 修改

- **D1**：`.github/workflows/quality.yml` 中 PR 的 `dev-fixtures` 作业安装 Puppeteer Chrome。原因：`pnpm run dev`（`scripts/dev-stack.mjs`）会先执行一次真实 PDF 检查，通过后才启动 Next。dev-stack 的这项预检保持不变。
- **启动参数**：新增 `lib/pdf/launch-options.ts`，三处启动 Chromium 的地方（Web 池、HEAVY 池、逐次启动）统一使用：
  - 关闭 Puppeteer 的信号接管。原因：它收到 SIGINT 时会执行 `process.exit(130)`。
  - `protocolTimeout` 取 60 秒，等于最长的渲染预算。
- **浏览器池**（`lib/pdf/browser-pool.ts`）：
  - 上下文关闭、浏览器关闭、强杀后确认退出，三步各有期限；
  - abort 监听一直保留到清理结束；
  - 只回收本任务使用的那个浏览器实例；
  - 超时后只对本池启动的进程组发 SIGKILL，已退出的进程不再发信号；
  - 确认旧进程退出之前，不启动新浏览器；无法确认退出时，池返回不可用，等进程真正退出后自动恢复；
  - 任务忽略 abort 时也会释放串行槽位；
  - HEAVY 的 60 秒预算从占用浏览器时起算，排队不消耗预算。
- **B2**（`lib/pdf/direct.ts`）：Web 进程只在第一次启动 Chromium 时注册 SIGINT/SIGTERM 处理，收到信号后：
  - 立即停止接受新的渲染；
  - 给在途渲染 15 秒宽限，到期后中止，让请求在 PM2 `kill_timeout`（30 秒）之前返回；
  - 如果没有其他监听者，排空后重新发出该信号，交给默认的退出处理。

## `protocolTimeout` 取值依据

使用真实的 `buildPrintHtml` 生成页面；设计图由本机 HTTP 服务提供（模拟 OSS），共 40 张 2400×2400 的 JPEG，合计 134.8 MiB。

| 场景 | 页数 | PDF | 准备（加载/网络空闲/就绪） | `Page.printToPDF` |
| --- | --- | --- | --- | --- |
| 50 款，无图 | 15 | 0.8 MiB | 1,236 ms | 741 ms |
| 20 款 × 2 张大图 | 9 | 135.5 MiB | 1,170 ms | 2,015 ms |
| 40 款 × 1 张大图 | 13 | 135.6 MiB | 1,161 ms | 2,182 ms |

三个场景的分页状态均为 `ready`。本机最慢的一次 printToPDF 是 2.2 秒，60 秒约有 27 倍余量。生产主机的 CPU 和内存都更弱，需要在 T2 资源验收中在目标环境重新测量。结论必须满足“最慢的合法 printToPDF 明显低于 60 秒”，否则应先调整预算，而不是单独调高 `protocolTimeout`。

## 真实 Chromium 故障注入

直接使用 `PdfBrowserPool` + `renderHtmlToPdf`。为缩短测试时间，渲染预算设为 8 秒，清理、关闭、确认退出三个期限都设为 3 秒（生产值为 5 秒）。

| 注入 | 结果 | 耗时 |
| --- | --- | --- |
| 渲染中对进程组发 `SIGSTOP` | `TimeoutError`，进程组被强杀并确认退出 | 11,015 ms（8 秒预算 + 3 秒关闭期限） |
| 冻结之后的下一次渲染 | 成功，1 页 | 1,301 ms |
| 渲染完成、关闭上下文之前 `SIGSTOP`（原 F1 场景） | 结果正常返回，随后回收浏览器 | 6,728 ms（清理 3 秒 + 关闭 3 秒） |
| 之后的下一次渲染 | 成功，1 页 | 1,179 ms |
| 渲染中对浏览器主进程发 `SIGKILL` | `TargetCloseError` | 31 ms |
| 之后的下一次渲染 | 成功，1 页 | 1,191 ms |

全程共启动 4 个浏览器，结束时 `pgrep -g` 查不到任何残留进程组。

## 停机信号（D2 / B2）

子进程模拟 `next start` 的行为：先注册自己的信号处理，等在途请求结束后以退出码 0 退出。发起一个 direct 下载，其中的图片永远不返回；Chromium 启动 2 秒后向子进程发送信号。

| 版本 | 信号 | 在途请求 | 进程退出 | 残留 Chromium |
| --- | --- | --- | --- | --- |
| 修改前（HEAD 的池代码） | SIGINT | 没有完成 | 24 ms 后以退出码 130 退出（被 Puppeteer 强制退出） | 无 |
| 修改后 | SIGINT | 15,004 ms 时返回 `PdfBrowserUnavailableError` | 15,030 ms 后以退出码 0 退出 | 无 |
| 修改后 | SIGTERM | 15,004 ms 时返回 | 15,026 ms 后以退出码 0 退出 | 无 |

尚未在真实 PM2 + `next start` 下演练 reload。以上只证明池和信号处理本身的行为，PM2 演练需要在生产同构环境中补做。

## D1 复现

用空的 `PUPPETEER_CACHE_DIR` 运行 `scripts/pdf-check.ts` 时退出码为 1，也就是 dev-stack 不会启动 Web；缓存中已有 Chrome 时生成 29,842 字节的中文 PDF，退出码为 0。CI 上的干净缓存启动，要在推送后以 PR 的 `dev-fixtures` 作业结果为准。

## 门禁

- PDF 单测：7 个文件、49 项全部通过。新增内容：
  - 池边界 15 项；
  - 启动参数与各启动点的一致性；
  - 停机宽限与信号重新发出。
- `pnpm typecheck`、`pnpm check:architecture`（1,132 个模块，24 项既有超长函数债务）、`pnpm test:backup` 均通过。
- `pnpm lint`：0 错误，2 个既有警告。
- 全量 Vitest：7,726 项通过、111 项跳过、0 项失败。另有 19 个文件在加载时因本机未设置 `DATABASE_URL` 而失败（`*.postgres.test.ts` 及直接 import `lib/db` 的文件），与本次改动无关；需要在迁移并 seed 过的单测库上复跑。

测试脚本位于被 git 忽略的 `.review/pdf-lifecycle/`，不入库。
