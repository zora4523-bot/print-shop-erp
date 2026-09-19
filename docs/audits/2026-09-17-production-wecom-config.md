# 2026-09-17 本地通知群配置迁入生产

## 授权与范围

负责人明确要求把本地测试群配置搬到正式环境。本次仅迁移已有智能机器人身份、已绑定群、消息规则和管理通知路由；应用版本仍为 `0e6c009b`。不迁移旧 Webhook 测试目标，不复制本地业务数据、用户、会话或历史投递记录，不额外发送测试消息。

## 执行

- 源为项目本地 `.env` 及本地开发库；核对 Bot ID 摘要与已绑定 GROUP 匹配，所有规则及管理路由只引用该智能机器人目标。本地无近期 LIGHT worker 心跳。
- 目标原无 NotificationChannel、无启用规则，管理通知路由关闭。将目标环境文件及通知配置单独备份到服务器 root 私有目录；仅更新机器人两项凭据和关闭通知 mock。
- 安全传输的配置文件为 0600，目录 0700；不将凭据、群 chatid 或消息模板正文写入 Git、命令参数或对话。
- 在数据库事务内新建目标群，重映射规则和管理路由中的 channel ID，同步关联表；共 15 条规则，其中 11 条启用、4 条关闭，保留源模板及开关。写入 `NOTIFICATION_CONFIGURATION_IMPORTED` 业务审计，不含密钥。
- 暂停 LIGHT worker 后应用配置，重启 Web/LIGHT 并保存 PM2；HEAVY 保持运行。首次导入辅助脚本有语法错误，未进入数据库操作；修正并完成语法检查后执行成功。没有更改应用源码。

## 验证

- 凭据匹配、机器人身份摘要、群绑定、全部规则模板、启用状态、两种关联及管理路由逐项校验通过，输出仅含布尔结果和数量。
- 生产 `/api/health/jobs`：status=ok，smartBot.status=CONNECTED，required=true，configurationValid=true，identityMatch=true，operational=true，alerts/warnings 为空；稳定连接门禁通过。
- 三个 PM2 进程 online、版本相同；本机与公网 live/ready 均 200，数据库 ok，3000 端口仅监听 loopback。
- 配置迁移已完成，业务通知按规则启用；未人为触发真实群消息，因此不把连接成功描述为群消息实收验收。
- 同一机器人当前由生产 LIGHT worker 持有连接；本地配置仍保留，后续不可同时启动使用该身份的本地 LIGHT worker，避免会话竞争。

服务器私有备份：`/root/erp-notification-production-20260917/`。导入传输文件验收后删除；保留受限备份和无密钥的操作脚本。生产实际凭据位于既有受限 `.env`，本次未轮换凭据；历史 `.env.example` 的轮换提示不构成已完成轮换的证据。
