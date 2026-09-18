import { OrderSettlementType } from '@/generated/prisma/enums';
import type {
  QuoteExternalOrderChargesInput,
  QuoteCreateOrderPackagingGroupsInput,
} from '@/lib/auth/schemas';
import type {
  CreateOrderQuoteItemInput,
  CreateOrderQuoteResult,
  InternalCreateOrderQuoteResult,
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

export type InternalCreateOrderQuoteActionInput = {
  factsKey: string;
  settlementType:
    | typeof OrderSettlementType.INTERNAL_SALES
    | typeof OrderSettlementType.FACTORY_DIRECT;
  items: CreateOrderQuoteItemInput[];
  orderItemCount: number;
  packagingGroups: QuoteCreateOrderPackagingGroupsInput['groups'];
  logistics: QuoteExternalOrderChargesInput;
};

export type InternalCreateOrderQuoteMutationResult =
  | { status: 'success'; quote: InternalCreateOrderQuoteResult }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
