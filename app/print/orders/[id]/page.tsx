import { notFound } from 'next/navigation';
import { getSession, requireSession } from '@/lib/auth/session';
import { getOrderForPrint } from '@/lib/order/print-view';
import { getOrderPrintTitleRef } from '@/lib/order/print-access';
import { orderPrintTitle } from '@/lib/page-title/titles';
import { derivePublicBaseUrl } from '@/lib/public-base-url';
import { getSetting } from '@/lib/settings';
import { OrderPrintLayout } from '@/lib/order/print-layout';
import { AutoPrint } from '@/components/business/order/AutoPrint';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { recordOrderPrintedAction } from '@/actions/order-print-record';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return { title: '工单打印' };
  const ref = await getOrderPrintTitleRef(id, session.user);
  return { title: orderPrintTitle(ref?.orderNo ?? null) };
}

export default async function OrderPrintViewPage({
  params,
  searchParams,
}: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  if (sp.mode !== undefined && sp.mode !== 'order') notFound();
  const baseUrl = await derivePublicBaseUrl();
  const order = await getOrderForPrint(
    id,
    { id: user.id, role: user.role },
    baseUrl,
  );
  if (!order) notFound();
  const { name: factoryName } = await getSetting('factory_name');

  // Browser print path opts in via `?autoprint=1`; Puppeteer visits
  // without the query so PDF capture happens cleanly. Accept any
  // truthy value but not the empty string.
  const autoprintRaw = sp.autoprint;
  const autoprintFlag = Array.isArray(autoprintRaw) ? autoprintRaw[0] : autoprintRaw;
  const autoprint =
    typeof autoprintFlag === 'string' &&
    autoprintFlag !== '' &&
    autoprintFlag !== '0' &&
    autoprintFlag.toLowerCase() !== 'false';

  // 业主 2026-10-02：点「打印」即记已打印。只有能处理工单的管理员、且是浏览器打印入口
  // （autoprint）时，打印对话框关闭后记录本次渲染的版本；服务端 PDF 不带 autoprint，不会记录。
  const canRecordPrint = autoprint && PERMISSIONS['order:change:review'].some((role) => role === user.role);
  const recordPrinted = canRecordPrint
    ? recordOrderPrintedAction.bind(null, { orderId: id, workOrderVersion: order.workOrderVersion })
    : undefined;

  return (
    <>
      <OrderPrintLayout key={`${id}:${order.workOrderVersion}`} order={order} factoryName={factoryName} />
      <AutoPrint key={`prepare:${id}:${order.workOrderVersion}`} enabled={autoprint} recordPrinted={recordPrinted} />
    </>
  );
}
