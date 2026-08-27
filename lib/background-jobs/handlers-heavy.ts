import { handleCdrBundleJob } from './cdr';
import { handleOrderExportJob } from './order-export';
import { handleOrderPdfJob } from './pdf';
import { BACKGROUND_JOB_TYPES } from './types';
import type { BackgroundJobHandlers } from './worker';

// HEAVY handlers need the normal Node/React server-rendering exports for PDF
// generation, so they are loaded separately from LIGHT notification modules.
export const heavyBackgroundJobHandlers: BackgroundJobHandlers = {
  [BACKGROUND_JOB_TYPES.CDR_BUNDLE]: handleCdrBundleJob,
  [BACKGROUND_JOB_TYPES.ORDER_PDF]: handleOrderPdfJob,
  [BACKGROUND_JOB_TYPES.ORDER_EXPORT]: handleOrderExportJob,
};
