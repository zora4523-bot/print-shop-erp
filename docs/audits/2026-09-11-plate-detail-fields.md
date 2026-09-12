# 制版明细字段精简

## 范围与兼容

- `OrderCommercialDetailsManager` 新增和编辑制版明细仅填写名称、单价、备注。
- 新增使用数量 1；编辑沿用原数量、版组和规格，数量大于 1 时显示在金额旁。
- 删除依据是共享编辑组件及其保存调用链：`saveOrderPlateDetailAction` → `saveOrderPlateDetail` 仍消费数量、规格和版组；金额仍由 Decimal 单价乘数量计算。`lib/order/export.ts` 仍导出历史字段。因此只移除输入控件及对应可编辑状态，不删除 schema、迁移、导出或后端字段。
- 未改动权限、价格版本、历史留痕和移除确认。

## 验证

- 实际已登录工单页面刷新后展开计价维护，新增和已有明细均仅显示三个填写字段；未对实际工单提交测试收费。
- `PlateDetailEditor.browser.spec.tsx`：14 项通过，覆盖新增提交参数、保存失败保留输入、历史数量和元数据保留，以及六视口 × 明暗主题的 overflow、44px 控件、axe 检查。
- 制版组件契约、收费 schema、commercial-details：16 项通过。
- 全仓 ESLint（排除未跟踪构建/报告目录）：0 错误、2 条既有导航警告；文案及 token 门禁通过。
- 类型检查排除生成物后仍失败于既有 `lib/pdf/render.ts:52` 的 `networkidle0` 类型，不涉及本次修改。
- 额外尝试旧 `OrderEditorAuxiliary.browser.spec.tsx`，其 mock 缺少 `ConfirmActionController` 导出，导入阶段失败；此次未修改该既有测试。本次独立浏览器测试使用真实确认组件并已通过。
