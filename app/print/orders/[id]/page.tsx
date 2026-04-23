import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { getOrderForPrint } from '@/lib/order/print-view';
import { OrderPrintLayout } from '@/components/business/order/OrderPrintLayout';
import { AutoPrint } from '@/components/business/order/AutoPrint';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `工单打印 · ${id.slice(0, 8)}` };
}

export default async function OrderPrintViewPage({
  params,
  searchParams,
}: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const order = await getOrderForPrint(id, { id: user.id, role: user.role });
  if (!order) notFound();

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

  return (
    <>
      <OrderPrintLayout order={order} />
      <AutoPrint enabled={autoprint} />
    </>
  );
}
