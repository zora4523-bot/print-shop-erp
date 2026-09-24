import { Role } from '../../generated/prisma/enums';

// ============================================================
// 权限字典：所有权限 key 集中在此（CLAUDE.md §4.6）。
// 修改权限规则只改此文件，不要散落在业务代码里。
//
// 这一份是纯数据，无副作用 —— 抽出独立文件让导航 / 测试等环境
// 可以引用 PERMISSIONS 而不被动拉入 next-auth、prisma 等运行时
// （permissions.ts 旧入口仍 re-export，调用方不变）。
// ============================================================

export const PERMISSIONS = {
  // 工单
  'order:create':               [Role.SALES, Role.ADMIN],
  'order:update:pre-schedule':  [Role.SALES, Role.ADMIN],
  'order:update:post-schedule': [Role.ADMIN],
  'order:view:all':             [Role.ADMIN],
  'order:view:self':            [Role.SALES, Role.WORKER],
  'order:export:all':           [Role.ADMIN],
  'order:ship':                 [Role.ADMIN],
  'order:mark-urgent':          [Role.SALES, Role.ADMIN],
  'order:cancel':               [Role.ADMIN, Role.SALES],
  'order:change:request':       [Role.SALES, Role.ADMIN],
  'order:change:review':        [Role.ADMIN],
  'order:production-facts:repair': [Role.ADMIN],
  'order:price:confirm':        [Role.ADMIN],

  // 新生产工序与历史任务异议
  'task:report':                [Role.WORKER],
  'task:dispute:create':        [Role.WORKER],
  'task:dispute:review':        [Role.ADMIN],

  // 考勤独立于人员派工；保留 ADMIN 角色集合但不复用 task:assign。
  'attendance:manage':          [Role.ADMIN],

  // 外协
  'outsource:manage':           [Role.ADMIN],

  // 设计文件
  'design:upload':              [Role.SALES, Role.ADMIN],
  'design:bundle:create':       [Role.ADMIN],

  // 物料
  'material:manage':            [Role.ADMIN],

  // 采购
  'purchase:manage':            [Role.ADMIN],

  // 仓库 / 库位
  'warehouse:manage':           [Role.ADMIN],

  // 账单
  'bill:manage':                [Role.ADMIN],
  'bill:view:all':              [Role.ADMIN],
  'bill:view:self':             [Role.SALES],
  'bill:mark-paid':             [Role.ADMIN],

  // 薪资
  'salary:view:all':            [Role.ADMIN],
  'salary:view:self':           [Role.WORKER],
  'salary:view:team':           [Role.ADMIN],
  'salary:rule:manage':         [Role.ADMIN],

  // 字典管理
  'party:manage':               [Role.ADMIN],
  'dict:product:manage':        [Role.ADMIN],
  'dict:craft:manage':          [Role.ADMIN],
  'dict:price:manage':          [Role.ADMIN],
  'bom:manage':                 [Role.ADMIN],

  // 推送
  'notification:config':        [Role.ADMIN],

  // 运维
  'setting:manage':             [Role.ADMIN],
  'ops:pigsty:view':            [Role.ADMIN],
  'ops:jobs:manage':            [Role.ADMIN],

  // 账号管理
  'account:manage':             [Role.ADMIN],

  // 报表
  'report:all':                 [Role.ADMIN],
  'report:production':          [Role.ADMIN],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/**
 * 纯谓词版权限判断。授权入口仍然是 permissions.ts 的 requirePermission()
 * （§4.6）；这个函数只给「需要软判断、不能抛」的场景用 —— 目前是各详情页
 * 的 generateMetadata：它决定标签页标题显示实体名还是模块名，绝不能成为
 * 唯一闸口，也绝不能抛错（流式 metadata 下首屏可能已经冲出去了）。
 */
export function hasPermission(permission: Permission, role: Role): boolean {
  const allowed = PERMISSIONS[permission] as readonly Role[] | undefined;
  return Boolean(allowed?.includes(role));
}
