## 问题与结果

任务编号/链接：

触发条件、原行为与修改后的行为：

## 范围与业务约束

涉及模块；权限、金额、状态和历史快照等必须保持的约束：

## 验证证据

按 [CONTRIBUTING.md](https://github.com/zora4523-bot/print-shop-erp/blob/main/CONTRIBUTING.md#测试要求) 选择与风险相称的验证，命令以
[DEVELOPMENT.md](https://github.com/zora4523-bot/print-shop-erp/blob/main/DEVELOPMENT.md#常用命令) 为准。填写实际执行结果，未执行不要打勾。

候选 SHA / 未提交增量：
运行模式（dev 或 build/start、mock 或真实服务、inline 或 durable）：
测试数据库隔离方式（不含凭据）：

| 检查与实际命令 | 通过 / 失败 / 跳过 | 日志、截图或 CI 证据 |
|---|---|---|
| | | |

缺陷原触发条件的回归结果、跳过原因、未覆盖范围：

- [ ] UI 改动符合 [文案与确认](https://github.com/zora4523-bot/print-shop-erp/blob/main/docs/ui-规范.md#文案与确认)，主题/键盘/触控按风险验证。
- [ ] UI 改动按 [Quality Standard §11](https://github.com/zora4523-bot/print-shop-erp/blob/main/docs/ui-规范.md#11-ui--ux-quality-standard) 完成十项 Design QA，附实际视口/状态、功能回归与修复复验证据；未执行项及阻断项已说明，P0/P1 与明显影响可用性、一致性、视觉层级的问题已清零。
- [ ] 未通过放宽断言、更新未确认的像素基线或降低门禁掩盖失败。

## 数据库与部署影响

- [ ] 无 Schema / migration 变化。
- [ ] 有新增前向 migration，已审查 SQL、完整 fresh 链和数据前后置条件；未改已应用迁移。
- [ ] 有需单独执行的生产操作，步骤、负责人、验证和恢复约束如下。

## 文档与遗留事项

同步的事实源/任务台账（路径或链接）：
剩余风险、待处理任务及负责人：

- [ ] 文档区分现行行为、待实现要求和历史证据；任务状态有对应 commit 与验证结果。
