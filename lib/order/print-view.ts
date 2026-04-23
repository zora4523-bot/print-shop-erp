import { db } from '../db';
import { Role } from '../../generated/prisma/enums';
import { getOrderScopeFilter } from '../auth/order-scope';
import { roleLabel } from '../auth/role-labels';
import type {
  PrintDesign,
  PrintOrder,
  PrintOrderItem,
  PrintTask,
} from '../../components/business/order/OrderPrintLayout.types';

// Loads the narrow shape the print layout needs. Scope filter mirrors
// getOrderDetail so SALES / CUSTOMER_SERVICE only print their own,
// OWNER / FOREMAN everything, WORKER (future) only what they have a
// task on. Returns null when the actor can't see the order — the page
// maps that to notFound() so there's no "this order exists but you
// can't print it" disclosure.
export async function getOrderForPrint(
  id: string,
  user: { id: string; role: Role },
): Promise<PrintOrder | null> {
  const order = await db.order.findFirst({
    where: {
      id,
      ...getOrderScopeFilter(user),
    },
    include: {
      submitter: {
        select: { displayName: true, role: true },
      },
      items: {
        orderBy: { sequence: 'asc' },
        include: {
          designs: {
            orderBy: { uploadedAt: 'asc' },
          },
          tasks: {
            orderBy: { createdAt: 'asc' },
            include: {
              craft: { select: { name: true } },
              worker: { select: { displayName: true } },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  // OrderItem.crafts is an array of Craft IDs (schema uses a String[]
  // rather than a join table). Collect the distinct IDs across the whole
  // order and resolve them in a single query instead of one-per-item.
  const craftIds = new Set<string>();
  for (const item of order.items) {
    for (const cid of item.crafts) craftIds.add(cid);
  }
  const craftNameById = new Map<string, string>();
  if (craftIds.size > 0) {
    const rows = await db.craft.findMany({
      where: { id: { in: [...craftIds] } },
      select: { id: true, name: true },
    });
    for (const row of rows) craftNameById.set(row.id, row.name);
  }

  const printItems: PrintOrderItem[] = order.items.map((item) => ({
    id: item.id,
    sequence: item.sequence,
    name: item.name,
    specification: item.specification,
    paperType: item.paperType,
    quantity: item.quantity,
    foilColor: item.foilColor,
    isDoubleSided: item.isDoubleSided,
    isDoubleColor: item.isDoubleColor,
    // Drop unresolvable IDs silently rather than rendering a raw cuid
    // into the printed sheet — if a craft was deleted, the workshop
    // shouldn't see garbage on paper.
    craftNames: item.crafts
      .map((cid) => craftNameById.get(cid))
      .filter((n): n is string => typeof n === 'string'),
    remark: item.remark,
    designs: item.designs.map(
      (d): PrintDesign => ({
        id: d.id,
        fileType: d.fileType,
        fileUrl: d.fileUrl,
        fileName: d.fileName,
        thumbnailUrl: d.thumbnailUrl,
        uploadedAt: d.uploadedAt,
      }),
    ),
    tasks: item.tasks.map(
      (t): PrintTask => ({
        id: t.id,
        craftName: t.craft.name,
        workerDisplayName: t.worker?.displayName ?? null,
      }),
    ),
  }));

  return {
    id: order.id,
    orderNo: order.orderNo,
    isUrgent: order.isUrgent,
    customerRef: order.customerRef,
    receiverName: order.receiverName,
    receiverPhone: order.receiverPhone,
    receiverAddress: order.receiverAddress,
    expressCode: order.expressCode,
    packageRequirement: order.packageRequirement,
    remark: order.remark,
    submittedAt: order.submittedAt,
    createdAt: order.createdAt,
    submitterDisplayName: order.submitter.displayName,
    submitterRoleLabel: roleLabel(order.submitter.role),
    items: printItems,
  };
}
