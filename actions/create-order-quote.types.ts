import { OrderSettlementType } from '@/generated/prisma/enums';
import type {
  QuoteExternalOrderChargesInput,
  QuoteOrderItemsInput,
  QuoteOrderPackagingGroupsInput,
} from '@/lib/auth/schemas';
import type { CreateOrderQuoteResult } from '@/lib/order/create-order-quote-service';

export type CreateOrderQuoteActionInput = {
  factsKey: string;
  settlementType: typeof OrderSettlementType.EXTERNAL_SALES;
  items: QuoteOrderItemsInput['items'];
  orderItemCount: number;
  packagingGroups: QuoteOrderPackagingGroupsInput['groups'];
  logistics: QuoteExternalOrderChargesInput;
};

export type CreateOrderQuoteMutationResult =
  | { status: 'success'; quote: CreateOrderQuoteResult }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
