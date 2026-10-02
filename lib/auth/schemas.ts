// 全站 Zod schema 的统一入口（CLAUDE.md §15.3）。实现按域拆在 lib/auth/schemas/ 下，
// 调用方继续从这里 import；新增 schema 请放进对应域文件，不要再往本文件堆。
// 各域文件里的 Prisma 枚举一律从 generated/prisma/enums 引入（零运行时），
// 这样客户端组件 zodResolver(createOrderSchema) 不会把 Prisma runtime 拖进浏览器包。
export * from './schemas/account';
export * from './schemas/catalog';
export * from './schemas/party';
export * from './schemas/inventory';
export * from './schemas/order-create';
export * from './schemas/order-edit';
export * from './schemas/production';
export * from './schemas/outsource';
export * from './schemas/salary';
export * from './schemas/finance';
export * from './schemas/notification';
export * from './schemas/design-upload';
export { YMD_RE, parseStrictYmd, parseStrictShanghaiDateTimeLocal } from './schemas/shared';
export * from './schemas/cdr-workbench';
