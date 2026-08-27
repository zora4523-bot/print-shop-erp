import { describe, expect, it } from 'vitest';
import {
  assignmentIssue,
  type DraftAssignment,
} from '../scheduling-allocation';

function assignment(
  workerId: string,
  plannedQty: string,
): DraftAssignment {
  return {
    clientId: `${workerId}-${plannedQty}`,
    workerId,
    plannedQty,
    overrideReason: '',
  };
}

describe('SchedulingForm split allocation validation', () => {
  it('accepts different workers whose quantities exactly cover the item', () => {
    expect(
      assignmentIssue(
        [assignment('worker-1', '600'), assignment('worker-2', '400')],
        1000,
      ),
    ).toBeNull();
  });

  it('rejects under/over allocation and duplicate workers', () => {
    expect(
      assignmentIssue(
        [assignment('worker-1', '600'), assignment('worker-2', '300')],
        1000,
      ),
    ).toMatch(/合计 900.*必须等于.*1000/);
    expect(
      assignmentIssue(
        [assignment('worker-1', '600'), assignment('worker-1', '400')],
        1000,
      ),
    ).toMatch(/不同师傅/);
  });
});
