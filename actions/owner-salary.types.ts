export type SalaryMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type RecomputeDailyResult =
  | {
      status: 'success';
      date: string;
      workerCount: number;
      errorCount: number;
      errors: Array<{ workerId: string; message: string }>;
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

export type RecomputeHourlyResult =
  | {
      status: 'success';
      month: string;
      workerCount: number;
      errorCount: number;
      errors: Array<{ workerId: string; message: string }>;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
