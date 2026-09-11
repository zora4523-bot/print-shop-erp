import { redirect } from 'next/navigation';

export const metadata = { title: '代理商月度账单' };

/** Compatibility alias after the permanent legacy Bill write cutover. */
export default function LegacyBillCompatibilityPage(): never {
  redirect('/owner/agent-bills');
}
