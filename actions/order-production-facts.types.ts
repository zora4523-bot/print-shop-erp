import type { repairLegacyProductionFacts } from '@/lib/order/legacy-production-facts';

export type RepairLegacyProductionFactsResult =
  | { status: 'success'; result: Awaited<ReturnType<typeof repairLegacyProductionFacts>> }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
