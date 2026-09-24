export type CsPayrollPaymentResult =
  | {
      status: 'success';
      paidBase: string;
      paidCommission: string;
      isFullyPaid: boolean;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type StartCsPeriodResult =
  | {
      status: 'success';
      periodId: string;
      periodStart: string;
      periodEnd: string;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type SettleCsPeriodResult =
  | {
      status: 'success';
      commissionId: string;
      totalSales: string;
      tierRate: string;
      commissionAmount: string;
      totalIncome: string;
      nextPeriodId: string | null;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type SettleReadyCsResult =
  | {
      status: 'success';
      settledCount: number;
      errorCount: number;
      errors: Array<{ periodId: string; message: string }>;
    }
  | { status: 'error'; message: string };

