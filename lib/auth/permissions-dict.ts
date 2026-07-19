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
  'order:create':               [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:update:pre-schedule':  [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:update:post-schedule': [Role.OWNER, Role.FOREMAN],
  'order:view:all':             [Role.OWNER, Role.FOREMAN],
  'order:view:self':            [Role.SALES, Role.CUSTOMER_SERVICE, Role.WORKER],
  'order:schedule':             [Role.OWNER, Role.FOREMAN],
  'order:ship':                 [Role.OWNER, Role.FOREMAN],
  'order:mark-urgent':          [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:cancel':               [Role.OWNER],

  // 生产任务
  'task:assign':                [Role.OWNER, Role.FOREMAN],
  'task:report':                [Role.WORKER],

  // 外协
  'outsource:manage':           [Role.OWNER, Role.FOREMAN],

  // 设计文件
  'design:upload':              [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'design:bundle:create':       [Role.OWNER, Role.FOREMAN],

  // 物料
  'material:manage':            [Role.OWNER, Role.FOREMAN],
  'material:issue':             [Role.OWNER, Role.FOREMAN, Role.WORKER],

  // 采购
  'purchase:manage':            [Role.OWNER],

  // 仓库 / 库位
  'warehouse:manage':           [Role.OWNER],

  // 账单
  'bill:view:all':              [Role.OWNER],
  'bill:view:self':             [Role.SALES, Role.CUSTOMER_SERVICE],
  'bill:mark-paid':             [Role.OWNER],

  // 薪资
  'salary:view:all':            [Role.OWNER],
  'salary:view:self':           [Role.CUSTOMER_SERVICE, Role.WORKER],
  'salary:view:team':           [Role.FOREMAN],
  'salary:rule:manage':         [Role.OWNER],

  // 字典管理
  'party:manage':               [Role.OWNER],
  'dict:product:manage':        [Role.OWNER],
  'dict:craft:manage':          [Role.OWNER],
  'dict:price:manage':          [Role.OWNER],
  'bom:manage':                 [Role.OWNER],

  // 推送
  'notification:config':        [Role.OWNER],

  // 运维
  'ops:pigsty:view':            [Role.OWNER],
  'ops:jobs:manage':            [Role.OWNER],

  // 账号管理
  'account:manage':             [Role.OWNER],

  // 报表
  'report:all':                 [Role.OWNER],
  'report:production':          [Role.OWNER, Role.FOREMAN],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
