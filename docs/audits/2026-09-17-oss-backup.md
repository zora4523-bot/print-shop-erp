# OSS 异地备份开发记录（2026-09-17）

起始 SHA：`e2c94155`，工作区干净。本批仅修改备份运维资产、只读检查、对应测试与文档；不改应用业务、薪资规则或数据库 schema。

## 已实现

- pgBackRest repo2 OSS 配置与最小权限 RAM 模板；独立加密、30 天保留策略、异步归档。
- 两个仓库分别执行的 systemd full backup 定时任务，失败重试与退出码传播；主库查询失败不能继续备份。
- 只读门禁精确匹配 stanza/current database，拒绝仓库重复、过期/超前备份、旧数据库 WAL，支持明确标记的离线 JSON 快照。
- 归档指标 SQL 与 canonical 部署/恢复/回退步骤；测试纳入 Quality CI。

## 实际验证

- `pnpm test:backup`：23 通过、0 失败、0 跳过；最初失败的 psql 错误传播用例已修复并通过原断言。
- 修改的 JS/MJS ESLint、Bash 语法、RAM JSON 语法、diff whitespace 检查通过。
- 数据库主机 systemd 252 验证 service/timer 通过；只在临时目录将 ExecStart 替换为同目录脚本路径，未安装或启用定时器。
- 正式库只读执行 monitor SQL：主库、归档失败已恢复、待归档段 0。未注入生产网络故障。
- 正式 pgBackRest info 快照经新版门禁返回 exit 1，原因“健康仓库 1，要求至少 2”，符合实际，未降低默认门槛。
- 云端应用凭证 GetBucketInfo/GetBucketACL 返回 403；Chrome OSS 控制台显示登录页，已保留待接续。

## 开发阶段未完成条件（下文记录后续进展）

云管理会话/备份专用凭证尚未提供。未建立异地 Bucket/RAM、未合并生产配置、未替换原 cron、未接入真实报警、未从 OSS 恢复；真实云端 RAM 策略与 S3 兼容性仍需实测。现有生产备份和业务服务保持原状，不能宣称异地备份已启用。此次只运行运维专项验证，不把历史全量业务测试记作本批测试。


## 生产接入与真实恢复（2026-09-17）

本批起点 `2b0fe5bc`，工作区干净。用户手动创建 Bucket/RAM 并提供本地 CSV 路径后接入；不改业务代码、正式业务数据或应用版本。

- 北京 Bucket `print-shop-erp-pgbackup-20260917`：GetBucketInfo/GetBucketACL 实测 Standard、ZRS、private、AES256；控制台创建结果显示阻止公共访问开启。数据库 ECS 位于杭州。
- 专用 AccessKey 仅通过受限文件读取和 SSH 传输，CSV 已设 0600。恢复配置及独立随机口令另存操作者本机 `~/.local/share/print-shop-erp-backup/repo2-recovery.conf`（目录 0700、文件 0600），生产 include `/etc/pgbackrest/conf.d/oss-repo2.conf`（postgres、0600）。密钥未写 Git；临时探测配置在演练结束后删除。
- 实测 S3 endpoint `s3.oss-cn-beijing.aliyuncs.com`、region `cn-beijing`、host URI、TLS 校验可用。独立配置 stanza-create 成功后才激活生产 repo2。
- 原配置、Patroni 文件、Pigsty inventory/templates、postgres crontab 保存于主机 `/var/backups/erp-oss-activation-20260917`。保留原 repo1 及备份；两 repo 设置 30 天 time retention；去掉 `archive-push-queue-max`；通过 patronictl 设置 archive_timeout=60，SHOW 确认 1min。Pigsty inventory 和模板同步，未在 Git 保存含凭证的生产 inventory。
- 权限实测：前缀内随机验证对象 PUT/GET 内容一致，ListObjects 成功，删除该验证对象成功，前缀外 GET 为 403。RAM 模板与实测策略对齐：ListObjects 仅允许带末尾斜杠的备份目录及其子前缀；移除非必需的 bucket 级 ListMultipartUploads，避免不支持 Prefix 条件的操作混入。
- OSS 首份 full `20260917-182715F`，12601920 字节仓库存储量，备份约 126 秒；随后 systemd repo2 service 实际成功生成 `20260917-183006F`。repo1 service 实际生成 `20260917-182954F`。两 service Result=success、ExecMainStatus=0。
- 安装并启用 `erp-pgbackrest-full@1.timer` / `@2.timer`，首次计划分别 2026-09-18 01:00 / 01:30 Asia/Shanghai；精确移除旧 cron 及 Pigsty 的该 cron 源配置。systemd 单元验证通过。
- `pgbackrest check` 通过；即时 info 快照经过 `BACKUP_REQUIRED_REPOS=2` 门禁通过。该快照不冒充持续监控。

### 恢复实证与边界

- 使用独立配置（只有 repo2，空 include 目录），显式 `--repo=2 --pg1-path=/var/lib/erp-oss-restore-20260917/data --archive-mode=off --type=immediate --target-action=promote` 恢复首份 OSS full；不读取 repo1。
- 同一主机的独立 PostgreSQL 16 集群，端口 55432，仅受限 Unix socket；独立 hba/config，listen_addresses 为空，archive_mode=off，shared/session preload 为空，无 Patroni/应用 worker/定时业务扩展。启动前核对恢复目录与生产 PGDATA 不同。
- 日志确认从 OSS 获取 WAL `000000010000002800000033` 起的日志并达到一致状态、promote 成功；redo 终点 `28/350003D0`。
- 23 张 Order/Bill/Salary/Payment 相关表逐表行数及所有行的排序 MD5 摘要完全一致（固定 UTC、日期和浮点格式）；包括 Order 29、Bill 4、DailyWorkerSalary 124、SalaryPeriod 1。数据库列表、角色属性和 ERP 扩展版本一致。
- 验证后已停止隔离集群，保留受限演练目录和日志；不监听业务端口、不覆盖生产数据。`type=immediate` 证明 full+WAL 一致恢复，不证明任意指定时间点 PITR，也不证明另一台主机的完整重建。
- 本批 `pnpm test:backup` 23 通过，RAM JSON 语法与 git diff 检查通过。

### 待补事项

- 数据库主机当前 Prometheus/Alertmanager 未运行；外部故障通知、恢复主机失效演练、指定时间点 PITR、隔离网络故障演练尚未完成。不能以定时器退出状态或一次 check 代替已接通告警。
- AccessKey 来源网络限制尚未配置，应核对实际调用出口并保留灾难恢复时增加新来源的流程。
- 本次诊断曾误输出已有 Pigsty 数据库凭据（非备份 AccessKey），已告知操作者并修正诊断为仅输出白名单字段；未将凭据写入仓库。需安排数据库与应用协调轮换，不能直接改密造成业务中断。
- 独立恢复口令已在操作者本机保存，仍建议进入正式凭据托管和应急取回流程。
