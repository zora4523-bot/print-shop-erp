import 'server-only';
import { db } from '../db';
import { prepareOrderForProductionInTx } from './production-readiness';
import { OrderStatus, Role } from '../../generated/prisma/enums';
import { updateOrderFields, OrderInvariantError } from '../order';
import { orderCascadeLockKey } from './locks';
import { proposedDueDateText, readProposedDueDate } from './change-due-date';
import {
  createOrderChangeRequest,
  previewOrderChangeRequestPricing,
  reviewOrderChangeRequest,
} from './change-request';
import { OrderChangeRequestError } from './change-request-error';
import {
  dispatchProductionCompletionNotification,
  type ProductionCompletionNotification,
} from '../production-completion';
import type {
  AdminOrderEditCommand,
  AdminOrderEditPreview,
} from './admin-edit-schema';

/** Used only after the transaction callback has finished. No preview writes or jobs survive. */
class PreviewRollback extends Error {
  constructor(readonly preview: AdminOrderEditPreview) {
    super('ADMIN_EDIT_PREVIEW_ROLLBACK');
  }
}

/** Same locks, ownership checks, re-quote and versioned approval as the existing workflow. */
export async function editAdminOrder(
  input: AdminOrderEditCommand,
  actor: { id: string; role: Role },
  mode: 'preview' | 'save',
): Promise<AdminOrderEditPreview | null> {
  if (actor.role !== Role.ADMIN)
    throw new OrderInvariantError('只有管理员可以直接保存款式修改');
  let completion: ProductionCompletionNotification | undefined;
  try {
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
        const before = await tx.order.findUnique({
          where: { id: input.orderId },
        });
        if (!before) throw new OrderInvariantError('工单不存在');
        if (
          before.editVersion !== input.fields.expectedEditVersion ||
          before.revision !== input.expectedRevision ||
          before.workOrderVersion !== input.expectedWorkOrderVersion
        ) {
          throw new OrderInvariantError(
            '工单已被其他人修改，请刷新页面后再编辑',
          );
        }
        if (before.status !== OrderStatus.DRAFT && input.items.some((item) => item.operation === 'ADD')) {
          throw new OrderInvariantError('仅草稿工单支持在编辑页新增款式；已提交工单请新建完整工单，以便上传设计图和 CDR');
        }
        // A date change shares the same proposal as the item changes. Never silently
        // bypass the confirmed-order date policy through the basic-field whitelist.
        const dateChanged =
          input.promisedDate !== undefined &&
          input.promisedDate !==
            (proposedDueDateText(before.promisedDate) ?? null);
        if (input.fields.promisedDate !== undefined) {
          throw new OrderInvariantError('请通过交期字段提交日期变更');
        }
        if (!input.items.length && input.pendingChargeResolutions.length) {
          throw new OrderInvariantError('本次未修改款式，不能提交重算运费');
        }
        await updateOrderFields(input.orderId, input.fields, actor, tx);
        let preview: AdminOrderEditPreview = {
          oldTotal: before.totalAmount.toFixed(2),
          newTotal: before.totalAmount.toFixed(2),
          quoteToken: null,
          priceRevision: before.priceRevision,
          complete: true,
          changesRevision: false,
          blockers: [],
        };
        if (input.items.length || dateChanged) {
          const context = {
            tx,
            requestId: input.requestId,
            onCompletion: (
              value: ProductionCompletionNotification | undefined,
            ) => {
              completion = value;
            },
          };
          const request = await createOrderChangeRequest(
            {
              orderId: input.orderId,
              expectedRevision: input.expectedRevision,
              expectedWorkOrderVersion: input.expectedWorkOrderVersion,
              type: 'MODIFY',
              modifyKind: input.items.length ? 'OTHER' : 'DUE_DATE',
              reason: '管理员编辑工单',
              items: input.items,
              ...(dateChanged
                ? { promisedDate: readProposedDueDate(input) }
                : {}),
            },
            actor,
            context,
          );
          const quoted = await previewOrderChangeRequestPricing(
            request.id,
            actor,
            { pendingChargeResolutions: input.pendingChargeResolutions },
            context,
          );
          preview = {
            oldTotal: quoted.oldTotal,
            newTotal: quoted.newTotal,
            productionFactsToken: quoted.productionFactsToken,
            quoteToken: quoted.quoteToken,
            priceRevision: quoted.priceRevision,
            complete: quoted.complete,
            changesRevision: true,
            pendingCharges: quoted.pendingCharges,
            blockers: quoted.pendingCharges
              .filter((charge) => charge.amount === null)
              .map(() => '请补齐本次待核运费并重新预览'),
          };
          if (mode === 'save') {
            if (
              !quoted.complete ||
              input.expectedProductionFactsToken !== quoted.productionFactsToken ||
              input.expectedQuoteToken !== quoted.quoteToken ||
              input.expectedPriceRevision !== quoted.priceRevision
            ) {
              throw new OrderChangeRequestError(
                '计价条件已变化或存在待核费用，请重新预览后保存',
              );
            }
            const reviewed = await reviewOrderChangeRequest(
              {
                requestId: request.id,
                decision: 'APPROVE',
                reviewRemark: '管理员核对差异后保存修改',
                expectedPriceRevision: quoted.priceRevision,
                expectedProductionFactsToken: quoted.productionFactsToken,
                pendingChargeResolutions: input.pendingChargeResolutions,
                ...(quoted.quoteToken !== null
                  ? { expectedQuoteToken: quoted.quoteToken }
                  : {}),
              },
              actor,
              context,
            );
            if (reviewed.status !== 'APPROVED')
              throw new OrderChangeRequestError(
                '工单版本或状态发生变化，请刷新后重新编辑',
              );
          }
        }
        if (mode === 'preview') throw new PreviewRollback(preview);
        await prepareOrderForProductionInTx(tx, input.orderId, actor, new Date());
        return null;
      },
      { timeout: 20_000 },
    );
    await dispatchProductionCompletionNotification(completion);
    return result;
  } catch (error) {
    if (error instanceof PreviewRollback) return error.preview;
    throw error;
  }
}
