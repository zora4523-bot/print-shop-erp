import { redirect } from 'next/navigation';

export default function OwnerExternalSalesLogisticsPriceBookPage() {
  redirect('/owner/prices/external-sales/items?purpose=logistics');
}
