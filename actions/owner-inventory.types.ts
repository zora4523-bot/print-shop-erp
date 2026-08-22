/**
 * 盘点过账的返回类型（'use server' 模块不能导出类型，CLAUDE.md §15.3）。
 *
 * 状态集合不变（success | invalid | error），只是给 success / error 挂一个可选
 * 负载——和 actions/order-quote.types.ts 给 'success' 挂 items 是同一个路数。
 *
 * · staleKeys —— 账面数在盘点期间被别人改过、**没有过账**的行，形如
 *   `${materialId}:${locationId}`，和 InventoryCountClient 那张表的行 key 同构，
 *   页面据此精确点名要求重数，而不是把操作员几十行手工数据全废掉。
 *   出现在 'success' 上是部分过账：其余行已经入库了，这张单是真的存在的。
 *   出现在 'error' 上是全量失效：一行都没过账。
 */
export type InventoryCountMutationResult =
  | { status: 'success'; message?: string; staleKeys?: string[] }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string; staleKeys?: string[] };
