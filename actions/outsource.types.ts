export type OutsourceMutationResult =
  | { status: 'success'; id: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type OutsourceAmountMutationResult =
  | { status: 'success'; id: string; amount: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type OutsourcePaymentMutationResult =
  | {
      status: 'success';
      paymentId: string;
      totalAmount: string;
      newPaidAmount: string;
      remainingAmount: string;
      isFullyPaid: boolean;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
