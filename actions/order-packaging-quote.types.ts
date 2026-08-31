export type OrderPackagingGroupQuotePreview = {
  groupKey: string;
  complete: boolean;
  errors: string[];
  suggestedUnitPrice: string | null;
  suggestedSubtotal: string | null;
};

export type OrderPackagingQuotePreview = {
  groups: OrderPackagingGroupQuotePreview[];
  suggestedTotal: string | null;
  requiresAdminConfirmation: boolean;
  errors: string[];
};

export type QuoteOrderPackagingGroupsMutationResult =
  | { status: 'success'; quote: OrderPackagingQuotePreview }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
