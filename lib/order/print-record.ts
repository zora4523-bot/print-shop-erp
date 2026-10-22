import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { orderPrintInstructionKey } from '../pdf/order-snapshot';
import { getSetting } from '../settings';
import { OrderPrintJobError, recordRenderedPrintInTx, type OrderPrintActor, type RenderedPrintOutcome } from './print-jobs';
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
    // 与加锁同一事务连接读取，不另占连接池。
    const order = await getOrderForPrint(attempt.orderId, actor, baseUrl, tx);
    if (!order) return false;
    const factoryName = (await getSetting('factory_name', tx)).name;
    return orderPrintInstructionKey(order, factoryName) === attempt.contentKey;
  }), { timeout: 15_000 });
}

/** 浏览器取得单张工单 PDF 后交回的记录凭据：文件响应头给出的内容摘要 + 本次下载尝试标识。 */
export type PdfDownloadAttempt = {
  orderId: string;
  contentKey: string;
  attemptId: string;
};

/**
 * 业主 2026-10-22「下载 PDF 也记已打印」：浏览器取得文件后调用，把手里这份 PDF 记为已打印。
 * 基准与打印页相同，都是**生产指令摘要**（`orderPrintInstructionKey`），忽略随生产推进变化的进度。
 *
 * 不用文件的完整快照：完整快照含完成 / 不良数量，而取得文件与记录之间隔着整份 PDF 的传输，产线
 * 活跃的工单在这几秒里报一次工就会让比对失败，下载永远记不上——正是业主要消除的那条「明明打印了
 * 还提示没打印」。纸上的进度数字因此可能比库里旧几秒，这与打印页已经接受的口径一致
 * （DECISIONS 2026-10-02 / 2026-10-22）。
 *
 * 版本从内容摘要所属的工单当场读取：摘要由接口在「仍是当前内容」复核之后签出，取到文件与记录
 * 之间工单又改过时，这里比对不上（STALE），不会把旧纸记成当前版本。
 *
 * 注意这条守卫依赖「`orderPrintInstructionKey` 随 `workOrderVersion` 变化」（该摘要显式列入了版本号）——下面读到的版本是加锁前
 * 的，锁内复查只能挡住版本变大的情形，旧纸被记成当前版本全靠内容摘要含版本号拦下。该不变量由
 * `lib/pdf/__tests__/order-snapshot.test.ts` 钉住，收窄这个摘要前先看那里的用例。
 */
export async function recordPdfDownload(
  attempt: PdfDownloadAttempt,
  actor: OrderPrintActor,
  baseUrl: string,
): Promise<RenderedPrintOutcome> {
  return db.$transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: attempt.orderId },
      select: { workOrderVersion: true },
    });
    if (!current) throw new OrderPrintJobError('ORDER_NOT_FOUND', '工单不存在');
    return recordRenderedPrintInTx(
      tx,
      {
        orderId: attempt.orderId,
        workOrderVersion: current.workOrderVersion,
        attemptKey: `pdf-download:${attempt.attemptId}`,
      },
      actor,
      async () => {
        const order = await getOrderForPrint(attempt.orderId, actor, baseUrl, tx);
        if (!order) return false;
        const factoryName = (await getSetting('factory_name', tx)).name;
        return orderPrintInstructionKey(order, factoryName) === attempt.contentKey;
      },
    );
  }, { timeout: 15_000 });
}
