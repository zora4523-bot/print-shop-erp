# 正式库恢复与压测数据清理（2026-09-16）

## 执行范围

用户要求恢复正式库、清除压测数据。此次操作恢复既有正式版本，没有执行新版数据库迁移，也没有重置正式业务数据。

## 发现与处理

- 生产域名 `https://bag.sshapi.cn` 原先指向应用机上的压测进程，使用本机 PostgreSQL 的 `print_shop_erp_loadtest`，共 30,000 张工单。
- 正式应用目录 `/var/www/print-shop-erp` 的三个进程原先停止。它连接 Pigsty 上独立的 `print_shop_erp`，保留 31 张工单、45 条已完成迁移。
- 停止压测 Web、LIGHT 和 HEAVY worker，完成压测库备份后，恢复正式目录中的既有构建，代码版本 `aa42ba00666b0145560c7a64eb19438953e0efd4`。
- 使用临时 PM2 配置将 Web 明确绑定至 `127.0.0.1:3000`，其余配置沿用既有正式配置。配置保存在应用机 `/root/erp-release-backup-20260916/restore-formal.config.cjs`，随后执行 `pm2 save`。
- 确认压测库连接数为 0、备份目录可读取、正式服务正常后，删除独立数据库 `print_shop_erp_loadtest`，从 PM2 删除三个压测进程并再次保存状态。保留压测程序目录和备份用于追溯，不再运行压测服务。

## 备份

正式库新增逻辑备份保存在数据库机 `/var/backups/erp-20260916/formal-before.dump`；压测库备份保存在应用机 `/root/erp-release-backup-20260916/loadtest-before.dump`。两份备份均复制至执行机受限目录 `/tmp/erp-prod-release-20260916/`，SHA-256 一致：

| 备份 | SHA-256 |
| --- | --- |
| 正式库 | `ff240d5b17906798bbbd1281df8d62a87438a8845a0a5443427b229d9e1e778d` |
| 压测库 | `c416cb1e4361edacfc5edca566c68f7862aec6326bc2c609efa6fbfd9330fb5b` |

已检查备份目录可解析，未将该检查表述为完整恢复演练。原有 pgBackRest 最近 full 为 `20260916-010002F`，当前仅 repo1；第二备份仓库和月度恢复演练仍需落实，不能视为新版部署门禁通过。

## 验证结果

- 正式数据库名称为 `print_shop_erp`，恢复后仍为 31 张工单、45 条已完成迁移。
- 生产域名 `/api/health/ready` 返回 `status: ok`、`db: ok`，库存差异数为 0。
- 生产域名 `/login` 返回 HTTP 200。
- 正式 Web、LIGHT、HEAVY 三个 PM2 进程均在线；压测进程已移除，PM2 状态已保存。
- 3000 端口只监听 `127.0.0.1`。
- 应用机 PostgreSQL 不再存在压测库，非模板数据库仅剩 `postgres`。
- 既有版本没有 `/api/health/jobs`（返回 404），不能以新版探针验收既有版本；本次检查了进程状态和既有 readiness。
- 正式环境预检通过，但已有 `SENTRY_DSN` 未配置警告。

## 新版部署状态

PR #21（`5b22865f19be0da519014aee38088a238fd48e7e`）包含寄样、打样、收费编辑和 CDR 批量上传。本次正式库恢复未部署这些新功能。记录时 CI 的单元/数据库测试步骤已结束，生产构建、业务 E2E 和六视口检查仍运行中；新版上线还需完成正式历史数据的迁移演练及适用发布门禁。
