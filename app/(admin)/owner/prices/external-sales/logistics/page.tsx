import { redirect } from 'next/navigation';
import { customerPricingHref } from '@/lib/navigation/rule-center';

export default function OwnerExternalSalesLogisticsPriceBookPage() {
  redirect(customerPricingHref('logistics'));
}
