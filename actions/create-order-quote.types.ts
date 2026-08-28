import { OrderSettlementType } from '@/generated/prisma/enums';
import type {
  QuoteExternalOrderChargesInput,
  QuoteCreateOrderPackagingGroupsInput,
} from '@/lib/auth/schemas';
import type {
  CreateOrderQuoteItemInput,
  CreateOrderQuoteResult,
} from '@/lib/order/create-order-quote-service';

export type CreateOrderQuoteActionInput = {
  factsKey: string;
  settlementType: typeof OrderSettlementType.EXTERNAL_SALES;
  items: CreateOrderQuoteItemInput[];
  orderItemCount: number;
  packagingGroups: QuoteCreateOrderPackagingGroupsInput['groups'];
  logistics: QuoteExternalOrderChargesInput;
};

export type CreateOrderQuoteMutationResult =
  | { status: 'success'; quote: CreateOrderQuoteResult }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
