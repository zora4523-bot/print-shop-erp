/**
 * Decoder-only shape for historical DailyWorkerSalaryItem snapshots.
 * It deliberately contains no calculator or rule lookup: old money is shown
 * exactly as stored and can never be recomputed through this module.
 */
export type LegacyMachineRuleSnapshot = {
  dailyBase?: string | number;
  pieceRate?: string | number;
  boardRate?: string | number;
  smallOrderThreshold?: number | null;
  smallOrderFlatPrice?: string | number | null;
  smallOrderInclusive?: boolean;
  largeOrderSetupFee?: string | number;
  multiplierFactors?: readonly ('DOUBLE_SIDED' | 'DOUBLE_COLOR')[];
};
