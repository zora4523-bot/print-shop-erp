export type OrderFormBQuoteStatus =
  | 'missing'
  | 'loading'
  | 'stale'
  | 'error'
  | 'incomplete'
  | 'complete';

export type OrderFormBRailQuoteItem = {
  key: string;
  design?: { key: string; label: string };
  specificationLabel?: string;
  label: string;
  status: OrderFormBQuoteStatus;
  amount: string | null;
  components: Array<{ label: string; amount: string }>;
  message?: string | null;
  pricingSource?: 'AUTO' | 'ADMIN';
};

export type OrderFormBRailLogistics = {
  status: OrderFormBQuoteStatus;
  shippingAmount: string | null;
  packagingAmount: string | null;
  totalAmount: string | null;
  shippingLabel?: string;
  packagingLabel?: string;
  message?: string | null;
};

export type ExternalSalesPackagingQuote = {
  status: OrderFormBQuoteStatus;
  amount: string | null;
  label?: string;
  message?: string | null;
  pricingSource?: 'AUTO' | 'ADMIN' | 'MIXED';
};

export type OrderFormBRailPlateFee = {
  status: 'PENDING';
  amount: null;
  displayAmount: '待定';
  label: string;
};

export type OrderFormBRailTotalSemantics = 'COMPLETE' | 'EXCLUDES_MANUAL_ITEMS';

export type OrderFormBRailProps = {
  itemCount: number;
  quoteItems: readonly OrderFormBRailQuoteItem[];
  packaging: ExternalSalesPackagingQuote;
  logistics: OrderFormBRailLogistics | null;
  usesExternalSalesPricing: boolean;
  allowSaveDraft?: boolean;
  allowEditFees?: boolean;
  settlementLabel: string;
  knownTotal?: string | null;
  totalSemantics?: OrderFormBRailTotalSemantics;
  plateFee?: OrderFormBRailPlateFee | null;
  gaps: readonly string[];
  busy: boolean;
  onAttemptSubmit: (intent: 'draft' | 'submit') => void;
  onItemClick?: (key: string) => void;
  onGapClick?: (index: number) => void;
};
