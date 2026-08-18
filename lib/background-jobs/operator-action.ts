import { BackgroundJobStatus } from '../../generated/prisma/enums';
import { BACKGROUND_JOB_TYPES } from './types';

export type BackgroundJobOperatorAction =
  | 'RETRY'
  | 'CANCEL'
  | 'REQUEST_NEW_EXPORT'
  | 'NONE';

export function backgroundJobOperatorAction(job: {
  type: string;
  status: BackgroundJobStatus;
}): BackgroundJobOperatorAction {
  if (job.status === BackgroundJobStatus.DEAD) {
    return job.type === BACKGROUND_JOB_TYPES.ORDER_EXPORT
      ? 'REQUEST_NEW_EXPORT'
      : 'RETRY';
  }
  if (job.status === BackgroundJobStatus.PENDING) return 'CANCEL';
  return 'NONE';
}
