import qrcode from 'qrcode';
import { db } from '../db';
import { Role } from '../../generated/prisma/enums';
import { getOrderScopeFilter } from '../auth/order-scope';
import { signDesignReadUrl } from '../oss/read-url';
import { roleLabel } from '../auth/role-labels';
import type {
  PrintDesign,
  PrintOrder,
  PrintOrderItem,
  PrintTask,
} from '../../components/business/order/OrderPrintLayout.types';

// QR SVG pre-render. Layout consumes plain SVG strings via
// dangerouslySetInnerHTML to dodge the qrcode.react / two-Reacts bug
// when the PDF route's renderToStaticMarkup dynamically imports
// react-dom/server (which loads its own React vs the bundled one and
// breaks hooks). margin=1 keeps the quiet zone tight; errorCorrection
// 'M' is the SPEC default (handles ~15% damage which prints can take).
async function buildQrSvg(value: string, size: number): Promise<string> {
  return qrcode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    width: size,
    margin: 1,
  });
}

// Loads the narrow shape the print layout needs. Scope filter mirrors
// getOrderDetail so SALES / CUSTOMER_SERVICE only print their own,
// ADMIN sees everything, WORKER (future) only what they have a
// task on. Returns null when the actor can't see the order — the page
// maps that to notFound() so there's no "this order exists but you
// can't print it" disclosure.
export async function getOrderForPrint(
  id: string,
  user: { id: string; role: Role },
  // 二维码内容的绝对 URL base（调用方用 derivePublicBaseUrl 推导）。
  // 码里存 URL 而不是裸 id：师傅用微信"扫一扫"直接打开报工页
  // （未登录先登录再回跳），不需要专用扫码器。
  baseUrl: string,
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

  // Pre-render every QR SVG in one Promise.all so we don't serialize
  // the I/O-bound calls. Order QR + one per task; task counts cap out
  // around 10–20 in practice.
  const taskQrPairs = order.items.flatMap((item) => item.tasks);
  const base = baseUrl.replace(/\/+$/, '');
  const [orderQrSvg, ...taskQrSvgs] = await Promise.all([
    buildQrSvg(`${base}/orders/${order.id}`, 95),
    ...taskQrPairs.map((t) => buildQrSvg(`${base}/worker/tasks/${t.id}`, 55)),
  ]);
  const taskQrById = new Map(
    taskQrPairs.map((t, i) => [t.id, taskQrSvgs[i] as string]),
  );

  const printItems: PrintOrderItem[] = order.items.map((item) => ({
    id: item.id,
    sequence: item.sequence,
    name: item.name,
    specification: item.specification,
    paperType: item.paperType,
    quantity: item.quantity,
    foilColors: item.foilColors,
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
        // bucket 私有：IMAGE 渲染前换成 30min 预签 GET（浏览器打印和
        // Puppeteer PDF 都在窗口内完成）。CDR 不签——打印视图按 SPEC
        // §E.2.1 过滤掉 CDR，不该在 HTML 里留可用下载 URL。
        fileUrl:
          d.fileType === 'IMAGE' ? signDesignReadUrl(d.fileUrl) : d.fileUrl,
        fileName: d.fileName,
        thumbnailUrl: d.thumbnailUrl
          ? signDesignReadUrl(d.thumbnailUrl)
          : d.thumbnailUrl,
        uploadedAt: d.uploadedAt,
      }),
    ),
    tasks: item.tasks.map(
      (t): PrintTask => ({
        id: t.id,
        craftName: t.craft.name,
        workerDisplayName: t.worker?.displayName ?? null,
        qrSvg: taskQrById.get(t.id) ?? '',
      }),
    ),
  }));

  return {
    id: order.id,
    orderNo: order.orderNo,
    customName: order.customName,
    isUrgent: order.isUrgent,
    promisedDate: order.promisedDate,
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
    orderQrSvg,
  };
}
