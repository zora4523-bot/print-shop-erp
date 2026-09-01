import { redirect } from 'next/navigation';

type PageProps = { params: Promise<{ id: string }> };

/** Preserve legacy deep links while exposing only the read-only archive. */
export default async function LegacyBillDetailCompatibilityPage({
  params,
}: PageProps): Promise<never> {
  const { id } = await params;
  redirect(`/owner/bills/archive/${encodeURIComponent(id)}`);
}
