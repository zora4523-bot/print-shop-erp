import type {
  CancellationSettlementPreview,
  OrderChangePricingPreview,
} from '@/lib/order/change-request';
import type { OrderPricingReviewPreview } from '@/lib/order/pricing-review';
import type { OrderPricingStatusValue } from '@/lib/order/pricing-status';
import type { OrderQuotedFeeCompleteness } from '@/generated/prisma/enums';

export type OrderMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type SubmitOrderMutationResult =
  | {
      status: 'success';
      readyForProduction?: boolean;
      quotedFee: string | null;
      quotedFeeCompleteness: OrderQuotedFeeCompleteness | null;
    }
  | {
      status: 'quote_changed';
      quoteToken: string;
      quotedFee: string;
      quotedFeeCompleteness: OrderQuotedFeeCompleteness;
      message: string;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type CreateOrderMutationResult =
  | {
      status: 'success';
      orderId: string;
      orderNo: string;
      itemIds: string[];
      pricingStatus: OrderPricingStatusValue;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type CreateReworkOrderMutationResult =
  | { status: 'success'; orderId: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type CreateOrderChangeRequestMutationResult =
  | { status: 'success'; requestId: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type ReviewOrderChangeRequestMutationResult =
  | { status: 'success'; requestStatus: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type WithdrawOrderChangeRequestMutationResult =
  | { status: 'success'; requestStatus: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type PreviewOrderChangeRequestPricingResult =
  | { status: 'success'; preview: OrderChangePricingPreview }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type PreviewOrderCancellationSettlementResult =
  | { status: 'success'; preview: CancellationSettlementPreview }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type PreviewOrderPricingReviewResult =
  | { status: 'success'; preview: OrderPricingReviewPreview }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type FinalizeOrderPricingMutationResult =
  | {
      productionReadiness?: { ready: boolean; issues: string[] };
      status: 'success';
      orderId: string;
      priceRevision: number;
      packagingAmount: string;
      processingAmount: string;
      totalAmount: string;
      confirmedFee: string;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type OrderCommercialDetailMutationResult =
  | {
      status: 'success';
      entityId: string;
      priceRevision: number;
      totalAmount: string;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
