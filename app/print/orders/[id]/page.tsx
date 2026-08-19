import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { getOrderForPrint } from '@/lib/order/print-view';
import { derivePublicBaseUrl } from '@/lib/public-base-url';
import { getSetting } from '@/lib/settings';
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
  const baseUrl = await derivePublicBaseUrl();
  const factory = await getSetting('factory_name');
  const order = await getOrderForPrint(
    id,
    { id: user.id, role: user.role },
    baseUrl,
  );
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
      <OrderPrintLayout order={order} factoryName={factory.name} />
      <AutoPrint enabled={autoprint} />
    </>
  );
}
