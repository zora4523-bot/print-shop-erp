import { createHash } from 'node:crypto';
import { db } from '../db';
import { Prisma } from '../../generated/prisma/client';
import { shanghaiDayBoundary } from '../dashboard/shanghai-clock';
import { isBundleSourceAddressValid } from './zip';
import { CdrBundleError, CdrBundleStaleError } from './errors';
import {
  CDR_WORKBENCH_PAGE_SIZE, cdrSelectionSchema,
  type CdrManifest, type CdrWorkbenchFilter, type CdrWorkbenchOrder,
} from './workbench-model';

const salesSelect = { id: true, username: true, displayName: true } as const;
export const cdrWorkbenchSelect = {
  id: true, orderNo: true, customName: true, status: true, submittedAt: true,
  settlementType: true, submitterRole: true, submitter: { select: salesSelect },
  sourceOrder: { select: { submitterRole: true, submitter: { select: salesSelect } } },
  items: { orderBy: { sequence: 'asc' }, select: {
    id: true, sequence: true, name: true,
    designs: { where: { fileType: 'CDR' }, orderBy: { id: 'asc' },
      select: { id: true, fileName: true, fileUrl: true, fileSize: true, uploadedAt: true } },
  } },
} satisfies Prisma.OrderSelect;
type Order = Prisma.OrderGetPayload<{ select: typeof cdrWorkbenchSelect }>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function workbenchOrderFacts(order: Order) {
  const sales = order.settlementType === 'EXTERNAL_SALES' ? order.submitter : order.sourceOrder?.submitter;
  const salesRole = order.settlementType === 'EXTERNAL_SALES' ? order.submitterRole : order.sourceOrder?.submitterRole;
  const external = sales && salesRole === 'SALES' ? sales : null;
  const salesId = external?.id ?? (order.settlementType === 'EXTERNAL_SALES' ? 'unknown' : 'internal');
  const salesLabel = external ? `${external.displayName}（${external.username}）` : salesId === 'internal' ? '内部工单' : '外部销售未填';
  const files = order.items.flatMap((item) => item.designs.map((d) => ({
    id: d.id, orderNo: order.orderNo, fileName: d.fileName, fileUrl: d.fileUrl,
    folders: [`${external?.displayName ?? salesLabel}_${digest(salesId).slice(0, 8)}`, order.orderNo, `${item.sequence}-${item.name}_${digest(item.id).slice(0, 8)}`],
  })));
  // File contents are immutable objects; include metadata too to detect historical in-place edits.
  const fingerprint = digest(order.items.map((item) => ({ id: item.id, designs: item.designs.map((d) => ({
    id: d.id, fileName: d.fileName, fileUrl: d.fileUrl,
    fileSize: String(d.fileSize), uploadedAt: d.uploadedAt.toISOString(),
  })) })));
  const missing = order.items.filter((item) => item.designs.length === 0).length;
  const invalid = files.some((file) => !isBundleSourceAddressValid(file.fileUrl));
  const issue = !order.submittedAt ? '工单尚未提交' : salesId === 'unknown' ? '外部销售未填' :
    order.items.length === 0 || missing ? `${missing || 1} 款缺少 CDR` : invalid ? '文件地址异常' : null;
  return { files, fingerprint, issue, salesId, salesLabel,
    version: digest([fingerprint, salesId, salesLabel, order.submittedAt]) };
}

export function workbenchWhere(filter: CdrWorkbenchFilter): Prisma.OrderWhereInput {
  return {
    submittedAt: { not: null,
      ...(filter.from ? { gte: shanghaiDayBoundary(filter.from).start } : {}),
      ...(filter.to ? { lt: shanghaiDayBoundary(filter.to).end } : {}),
    },
    ...(filter.scope === 'pending' ? { purpose: { not: 'SAMPLE_SHIPMENT' }, status: { in: ['CONFIRMED', 'RELEASED', 'SCHEDULING'] } } : {}),
    ...(filter.q ? { OR: [
      { orderNo: { contains: filter.q, mode: 'insensitive' } },
      { customName: { contains: filter.q, mode: 'insensitive' } },
      { submitter: { OR: [{ displayName: { contains: filter.q, mode: 'insensitive' } }, { username: { contains: filter.q, mode: 'insensitive' } }] } },
      { sourceOrder: { submitter: { OR: [{ displayName: { contains: filter.q, mode: 'insensitive' } }, { username: { contains: filter.q, mode: 'insensitive' } }] } } },
    ] } : {}),
  };
}

export async function listWorkbenchOrders(filter: CdrWorkbenchFilter) {
  const where = workbenchWhere(filter);
  const total = await db.order.count({ where });
  const page = Math.min(filter.page, Math.max(1, Math.ceil(total / CDR_WORKBENCH_PAGE_SIZE)));
  const rows = await db.order.findMany({ where, select: cdrWorkbenchSelect,
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * CDR_WORKBENCH_PAGE_SIZE, take: CDR_WORKBENCH_PAGE_SIZE });
  // Only one small fingerprint per order crosses the database boundary. The GIN
  // index bounds membership lookup; legacy packages intentionally return null.
  const snapshots = rows.length ? await db.$queryRaw<Array<{ orderId: string; fingerprint: string | null }>>(Prisma.sql`
    SELECT requested.id AS "orderId", (
      SELECT item->>'fingerprint'
      FROM jsonb_array_elements(CASE WHEN latest.manifest->>'version' = '1'
        AND jsonb_typeof(latest.manifest->'orders') = 'array'
        THEN latest.manifest->'orders' ELSE '[]'::jsonb END) item
      WHERE item->>'id' = requested.id LIMIT 1
    ) AS fingerprint
    FROM unnest(ARRAY[${Prisma.join(rows.map((row) => row.id))}]::text[]) requested(id)
    JOIN LATERAL (
      SELECT manifest FROM "DesignBundle"
      WHERE status = 'READY' AND "zipFileUrl" NOT LIKE 'mock://%'
        AND "orderIds" @> ARRAY[requested.id]::text[]
      ORDER BY "createdAt" DESC, id DESC LIMIT 1
    ) latest ON true
  `) : [];
  const latest = new Map(snapshots.map((row) => [row.orderId, row.fingerprint]));
  const orders: CdrWorkbenchOrder[] = rows.map((order) => {
    const facts = workbenchOrderFacts(order);
    const last = latest.get(order.id);
    return {
      id: order.id, orderNo: order.orderNo, name: order.customName || '未命名工单',
      salesId: facts.salesId, salesLabel: facts.salesLabel, status: order.status,
      submittedAt: order.submittedAt!.toISOString(), fileCount: facts.files.length,
      version: facts.version, issue: facts.issue,
      packageState: last === undefined ? 'new' : last === null ? 'unknown' : last === facts.fingerprint ? 'unchanged' : 'updated',
    };
  });
  return { orders, total, page };
}

/** Re-read current ownership and files; never trust the displayed selection or client archive paths. */
export async function collectWorkbenchSelection(selection: unknown) {
  const parsed = cdrSelectionSchema.safeParse(selection);
  if (!parsed.success) throw new CdrBundleError('请选择 1 至 100 个不重复的工单');
  const orders = await db.order.findMany({ where: { id: { in: parsed.data.map((r) => r.id) } }, select: cdrWorkbenchSelect });
  if (orders.length !== parsed.data.length) throw new CdrBundleError('工单已变更，请刷新后重新选择');
  const manifest: CdrManifest = { version: 1, orders: [], files: [] };
  for (const order of orders) {
    const facts = workbenchOrderFacts(order);
    if (facts.issue) throw new CdrBundleError(`${order.orderNo}：${facts.issue}`);
    if (facts.version !== parsed.data.find((r) => r.id === order.id)?.version) throw new CdrBundleError(`${order.orderNo} 工单或文件已更新，请刷新后重新选择`);
    manifest.orders.push({ id: order.id, fingerprint: facts.fingerprint });
    manifest.files.push(...facts.files);
  }
  const dates = orders.map((o) => o.submittedAt!.getTime());
  return { manifest, start: new Date(Math.min(...dates)), end: new Date(Math.max(...dates) + 1),
    orderIds: orders.map((o) => o.id), designIds: manifest.files.map((f) => f.id), files: manifest.files };
}

export async function validateWorkbenchManifest(manifest: CdrManifest) {
  const orders = await db.order.findMany({ where: { id: { in: manifest.orders.map((o) => o.id) } }, select: cdrWorkbenchSelect });
  if (orders.length !== manifest.orders.length || orders.some((o) => workbenchOrderFacts(o).fingerprint !== manifest.orders.find((s) => s.id === o.id)?.fingerprint)) {
    throw new CdrBundleStaleError();
  }
}

/** Historical regeneration is a domain read, with no database details in actions. */
export async function workbenchRegenerationSelection(bundleId: string) {
  const bundle = await db.designBundle.findUnique({ where: { id: bundleId }, select: { orderIds: true } });
  if (!bundle || bundle.orderIds.length > CDR_WORKBENCH_PAGE_SIZE) throw new CdrBundleError('请在工单列表中分批重新选择');
  const orders = await db.order.findMany({ where: { id: { in: bundle.orderIds } }, select: cdrWorkbenchSelect });
  if (orders.length !== bundle.orderIds.length) throw new CdrBundleError('原工单已变更，请重新选择');
  return orders.map((order) => ({ id: order.id, version: workbenchOrderFacts(order).version }));
}
