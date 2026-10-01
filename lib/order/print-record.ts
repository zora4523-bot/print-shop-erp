import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { orderPrintInstructionKey } from '../pdf/order-snapshot';
import { getSetting } from '../settings';
import { recordRenderedPrintInTx, type OrderPrintActor, type RenderedPrintOutcome } from './print-jobs';
import type { PrintOrder } from './print-types';
import { getOrderForPrint } from './print-view';

/** 打印页渲染时交给浏览器的记录凭据：本页生产指令摘要 + 本次打印尝试标识。 */
type PrintPageAttempt = {
  orderId: string;
  workOrderVersion: number;
  contentKey: string;
  attemptKey: string;
};

export function newPrintPageAttempt(order: PrintOrder, factoryName: string): PrintPageAttempt {
  return {
    orderId: order.id,
    workOrderVersion: order.workOrderVersion,
    contentKey: orderPrintInstructionKey(order, factoryName),
    attemptKey: `print-page:${randomUUID()}`,
  };
}

/**
 * 业主 2026-10-02「点打印即记已打印」：打印页关闭浏览器打印对话框后记录。在工单锁内重新读取打印
 * 内容，比较生产指令摘要——进度（状态、完成数量等）随生产推进变化不影响，生产师傅、款式、
 * 包装、收货等纸面指令变了就不记录。
 */
export async function recordPrintPage(
  attempt: PrintPageAttempt,
  actor: OrderPrintActor,
  baseUrl: string,
): Promise<RenderedPrintOutcome> {
  return db.$transaction((tx) => recordRenderedPrintInTx(tx, attempt, actor, async () => {
    const order = await getOrderForPrint(attempt.orderId, actor, baseUrl);
    if (!order) return false;
    const factoryName = (await getSetting('factory_name')).name;
    return orderPrintInstructionKey(order, factoryName) === attempt.contentKey;
  }), { timeout: 15_000 });
}
