
// 详情页浏览器标签标题 —— 业务编号在前、模块名在后。
//
// 为什么不是「工单 · GD-260821-001」：ERP 使用者常同时开七八个标签，
// 标签宽度只够显示开头十来个字符，模块名放前面会让所有标签长得一样。
// 参照 app/(admin)/owner/boms/[id] 已有写法（`${bom.name} · BOM/用料`）。
//
// 取不到实体时的回落分两种：
//   - 页面走 notFound() 的 → `X不存在`（跟随 owner/products/[id] 的 '产品不存在'）
//   - 页面走 redirect()、或当前角色本就无权读的 → 模块名本身，
//     不透露「这个 id 存在但你看不到」。

export function orderDetailTitle(orderNo: string | null): string {
  return orderNo ? `${orderNo} · 工单` : '工单不存在';
}

export function orderEditTitle(orderNo: string | null): string {
  return orderNo ? `${orderNo} · 编辑工单` : '工单不存在';
}

export function orderPrintTitle(orderNo: string | null): string {
  // 浏览器打印对话框拿 document.title 当默认文件名，这里给出的就是
  // 另存 PDF 时看到的名字。
  return orderNo ? `${orderNo} · 工单打印` : '工单打印';
}

export function adminBillTitle(
  ref: { period: string; salesUserName: string } | null,
): string {
  return ref ? `${ref.period} ${ref.salesUserName} · 账单` : '账单不存在';
}

export function salesBillTitle(period: string | null): string {
  // 外部销售看的是自己的账单，名字是冗余信息，只留账期。
  return period ? `${period} · 账单` : '账单不存在';
}

export function outsourceTitle(
  ref: { supplierName: string; orderNo: string | null } | null,
): string {
  if (!ref) return '外协单不存在';
  return ref.orderNo
    ? `${ref.orderNo} ${ref.supplierName} · 外协单`
    : `${ref.supplierName} · 外协单`;
}

export function workerTaskTitle(
  ref: { orderNo: string; sequence: number } | null,
): string {
  return ref ? `${ref.orderNo} #${ref.sequence} · 任务` : '任务不存在';
}
