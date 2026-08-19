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
  'order:create':               [Role.SALES, Role.CUSTOMER_SERVICE, Role.ADMIN],
  'order:update:pre-schedule':  [Role.SALES, Role.CUSTOMER_SERVICE, Role.ADMIN],
  'order:update:post-schedule': [Role.ADMIN],
  'order:view:all':             [Role.ADMIN],
  'order:view:self':            [Role.SALES, Role.CUSTOMER_SERVICE, Role.WORKER],
  'order:export:all':           [Role.ADMIN],
  'order:schedule':             [Role.ADMIN],
  'order:ship':                 [Role.ADMIN],
  'order:mark-urgent':          [Role.SALES, Role.CUSTOMER_SERVICE, Role.ADMIN],
  'order:cancel':               [Role.ADMIN],
  'order:change:request':       [Role.SALES, Role.CUSTOMER_SERVICE],
  'order:change:review':        [Role.ADMIN],

  // 生产任务
  'task:assign':                [Role.ADMIN],
  'task:report':                [Role.WORKER],

  // 外协
  'outsource:manage':           [Role.ADMIN],

  // 设计文件
  'design:upload':              [Role.SALES, Role.CUSTOMER_SERVICE, Role.ADMIN],
  'design:bundle:create':       [Role.ADMIN],

  // 物料
  'material:manage':            [Role.ADMIN],
  'material:issue':             [Role.ADMIN, Role.WORKER],

  // 采购
  'purchase:manage':            [Role.ADMIN],

  // 仓库 / 库位
  'warehouse:manage':           [Role.ADMIN],

  // 账单
  'bill:view:all':              [Role.ADMIN],
  'bill:view:self':             [Role.SALES],
  'bill:mark-paid':             [Role.ADMIN],

  // 薪资
  'salary:view:all':            [Role.ADMIN],
  'salary:view:self':           [Role.CUSTOMER_SERVICE, Role.WORKER],
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
