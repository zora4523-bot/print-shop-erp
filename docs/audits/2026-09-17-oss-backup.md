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

## 未完成条件

云管理会话/备份专用凭证尚未提供。未建立异地 Bucket/RAM、未合并生产配置、未替换原 cron、未接入真实报警、未从 OSS 恢复；真实云端 RAM 策略与 S3 兼容性仍需实测。现有生产备份和业务服务保持原状，不能宣称异地备份已启用。此次只运行运维专项验证，不把历史全量业务测试记作本批测试。
