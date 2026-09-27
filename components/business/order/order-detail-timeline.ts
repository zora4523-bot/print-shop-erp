// 管理员工单详情的取消影响摘要（旧的非管理员详情时间线已随客服角色删除）。

export function orderCancelImpact(input: {
  pendingProductionCount: number;
  inProgressProductionCount: number;
  completedProductionCount: number;
  liveOutsourceCount: number;
}): Array<{ label: string; value: string }> {
  return [
    {
      label: '取消未开工的生产工序',
      value: `${input.pendingProductionCount} 个`,
    },
    {
      label: '进行中工序需人工收尾',
      value: `${input.inProgressProductionCount} 个`,
    },
    {
      label: '已报工记录保留金额快照',
      value: `${input.completedProductionCount} 个`,
    },
    {
      label: '外协单需人工处理',
      value:
        input.liveOutsourceCount > 0
          ? `${input.liveOutsourceCount} 单已发出或进行中`
          : '无进行中外协',
    },
  ];
}
