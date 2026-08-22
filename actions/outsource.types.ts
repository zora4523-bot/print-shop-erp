export type OutsourceMutationResult =
  // notice：操作本身成功，但顺带有主管必须知道的后果（目前只有一种——
  // 收货后工单仍未完工，因为还有款式没被任何外协单覆盖）。它不是错误，
  // 所以不能用 status:'error'（那会让 UI 以为收货失败，而收货事务其实
  // 已经提交，那才是真正的误导）。
  | { status: 'success'; id: string; notice?: string }
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
