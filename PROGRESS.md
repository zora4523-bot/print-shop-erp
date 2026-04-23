# 开发进度

> 本文档记录"当前做到哪了、下一步做什么"。每次 session 结束前更新。

## 当前阶段

**P0 阶段 3/9：工单核心完成（E-lean），准备开 P0 #4 生产流程**

## 最后更新

2026-04-23

## 已完成

- [x] 项目初始化（Next 16.2 + Prisma 7 + 记忆管理体系）
- [x] **P0 #1 认证与用户管理**（commits `881ed75 → 6ef01fe`, 149 单测）
  - 认证基础 / 登录页 / 自服务改密 / 登出 / 老板管账号 CRUD
  - PG advisory xact lock 原子不变量、bcrypt 72-byte 短路
  - 15 轮 Codex review 全部闭合
- [x] **P0 #2 工艺 + 产品字典**（commits `25b2623 → 25bfebf`, +100 单测 = 249）
  - 工艺字典：列表 / 新建 / 编辑 / 启停，排序 + 默认机器 + 外协标记
  - 产品字典：分类 + 规格 + 纸张 + 建议单价 + 起订量
  - Decimal(10,4) 精度守卫、minOrderQty 严格 int 解析
  - 9 轮 Codex review；round 24 跨三份字典统一修"双 isActive 控件" + "post-create 不跳"
- [x] **P0 #3 工单核心（E-lean）**（commits `791f731 → e22b643`, 21 commits, +151 单测 = 400）
  - **Slice A1/A1b/B — 创建 / 提交 / 取消 + 销售端 UI**（rounds 25–28 clean）
    - `YYYYMMDD-XXXX` 工单号（Asia/Shanghai tz + 每日 advisory lock + max serial 跳洞）
    - 状态机 `transitionOrder` 铁律（§4.3，8 个状态）
    - RHF + useFieldArray 动态款式，工艺多选 checkbox list
    - submit-ownership 守卫 at action boundary + lib 重校（round 27 belt-and-suspenders）
    - 权限作用域 `getOrderScopeFilter`（SALES/CS own, OWNER/FOREMAN all, WORKER 仅自己有任务的）
  - **Slice C — OSS 直传脚手架**（rounds 29–33 clean）
    - env 四态 discriminated union `SignUploadResult`（ok / not-configured / invalid / error）
    - `OssNotWiredError` 显式桩，STS SDK 落地时替换 6 行实现
    - 路径注入守卫（`SAFE_ID_RE`）、扩展名 / fileType 匹配、`application/octet-stream` 通道防滥用
    - `deriveBucketUrl` 从 `OSS_ENDPOINT` 派生上传主机（VPC / 自定义端口 / IPv6 拒绝 / 已虚拟主机格式拒绝）
  - **Slice D — 打印 + PDF 双通道**（rounds 34–35 clean）
    - `/print/orders/[id]` 独立 top-level 段（避免继承 `/orders` nav）
    - `AutoPrint` client 组件按 `?autoprint=1` 分叉浏览器打印 vs Puppeteer PDF
    - `GET /api/orders/[id]/pdf` 进程内 `renderToStaticMarkup` + `page.setContent` → `page.pdf()`
    - `design-grid` 纯函数按数量分档（1/2/3-4/5-6/7-9/many）覆盖 SPEC 附录 E.2.1
  - **Slice E (E-lean) — 编辑 / 急单 / OrderLog diff**（round 36 clean，无 findings）
    - `editable-fields.ts` 按状态分三档（FULL / SHIPPING_ONLY / NONE），`pickEditableFields` 防御性 allowlist
    - `updateEditableOrderSchema` 完全 partial（缺 key 不改 / 空串清空 / 显式值写入）
    - 独立 `optionalFormBoolean` 区分 undefined vs false，防表单缺 checkbox 时误翻 isUrgent
    - 急单 toggle 仅在 FULL 状态可见；lib 层同样用 allowlist 守，即使绕过 UI 也不会污染 SCHEDULING+ 状态
    - OrderLog 按字段 diff 渲染（中文 label、状态枚举翻译、before → after 行）
  - **E-full（款式级增删改）延期到 P1**（业主 2026-04-23 拍板，临时解法：取消旧工单重建）

## 进行中

（无，准备开 P0 #4）

## 下一步

按 README "开发路径（P0 优先级）" 顺序推进：

4. **P0-4 生产流程**（预计 1 周）— **下一个**
   - 车间主管排产 → `ProductionTask` 生成 + 派师傅 + 机器类型快照
   - 师傅手机 H5 报工（合格数 / 不良数 / 返工数）
   - 板数 / 下数计算 + 计件金额（需 `lib/salary/machine-piecework` — 可提前起头）
   - 状态流转：SCHEDULING → IN_PRODUCTION → COMPLETED
5. **P0-5 薪资系统**（预计 2 周，核心难点）
6. **P0-6 应收账单**（3 天）
7. **P0-7 CDR 汇总**（2 天）
8. **P0-8 推送 + Dashboard**（1 周）
9. **P0-9 测试 + 上线**（3 天）

## P1 待办（已记录不拖 P0）

- **工单款式级编辑（E-full）** — item 增删改、OrderItem / OrderItemDesign 同步、OrderLog 内嵌款式 diff。当前 workaround：DRAFT/SUBMITTED 取消重建。
- **OSS 真实 STS SDK 接入** — `lib/oss/sign.ts signViaSts` 目前是抛 `OssNotWiredError` 的桩；业主 OSS 账号 / STS role 到齐后替换 6 行实现即可，`SignUploadResult` 契约不变。
- **设计文件孤儿清理** — SPEC §F.3 提到"定期清理删除工单的孤立文件"；待 P0 #3 真实上传流上线后评估。

## 待澄清的业务问题

- **ProductCategory 中文标签** — `lib/auth/role-labels.ts` 里是根据 enum 名猜的。业主过一眼 `/owner/products` 列表 + SPEC 附录 C 对一遍，如需更名在 `PRODUCT_CATEGORY_LABELS` 改即可。
- **设计图 "无法预览 CDR" 方案** — CDR 源文件目前只存不显；车间打印视图 SPEC §E.2.1 明确"CDR 不打印"。客服想在详情页预览 CDR 时怎么处理（占位缩略图 / "请下载"按钮 / 打开专用预览器）——等真实上传流跑起来再听业主反馈。

## 已知技术债

- `middleware.ts` 在 Next.js 16 有 deprecation warning。TODO 已写在注释里。独立一次迁移 commit 搞定。
- 账号/工艺/产品三份 UI 有大量结构近似的 "ToggleActiveButton" 组件。目前三份独立；可抽公共组件但等第 4 次出现再抽（避免过早抽象）。
- `app/orders/[id]/page.tsx` `formatDateTime` 用本地 `new Date(...).getX()`，和打印视图的 `Asia/Shanghai Intl.DateTimeFormat` 不一致。详情页当前只运行在国内服务器上不会出错，但和 `print-view.ts` 统一到 Asia/Shanghai 会更稳。
- Puppeteer 首次运行需要 `npx puppeteer browsers install chrome` 下载 Chromium（~170MB），部署 checklist 里要补一步。
