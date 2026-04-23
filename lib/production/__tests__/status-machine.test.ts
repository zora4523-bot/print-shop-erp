import { describe, it, expect } from 'vitest';
import { TaskStatus } from '../../../generated/prisma/enums';
import {
  TASK_TRANSITIONS,
  InvalidTaskTransitionError,
  canTransitionProductionTask,
  isTerminalTaskStatus,
  transitionProductionTask,
} from '../status-machine';

describe('TASK_TRANSITIONS', () => {
  it('mirrors SPEC §4.3 happy path', () => {
    expect(TASK_TRANSITIONS[TaskStatus.PENDING]).toContain(TaskStatus.IN_PROGRESS);
    expect(TASK_TRANSITIONS[TaskStatus.IN_PROGRESS]).toContain(TaskStatus.COMPLETED);
  });

  it('allows CANCELLED from any non-terminal state', () => {
    expect(TASK_TRANSITIONS[TaskStatus.PENDING]).toContain(TaskStatus.CANCELLED);
    expect(TASK_TRANSITIONS[TaskStatus.IN_PROGRESS]).toContain(TaskStatus.CANCELLED);
  });

  it('COMPLETED and CANCELLED are terminal', () => {
    expect(TASK_TRANSITIONS[TaskStatus.COMPLETED]).toEqual([]);
    expect(TASK_TRANSITIONS[TaskStatus.CANCELLED]).toEqual([]);
  });

  it('covers every TaskStatus variant (exhaustiveness guard)', () => {
    for (const s of Object.values(TaskStatus)) {
      expect(TASK_TRANSITIONS[s]).toBeDefined();
    }
  });
});

describe('transitionProductionTask', () => {
  it('returns the target on a valid move', () => {
    expect(transitionProductionTask(TaskStatus.PENDING, TaskStatus.IN_PROGRESS)).toBe(
      TaskStatus.IN_PROGRESS,
    );
  });

  it('throws on an illegal backwards move (COMPLETED → IN_PROGRESS)', () => {
    expect(() =>
      transitionProductionTask(TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS),
    ).toThrow(InvalidTaskTransitionError);
  });

  it('throws on a skip (PENDING → COMPLETED)', () => {
    // Must go through IN_PROGRESS; skipping is a silent "who worked on
    // this?" hole that the board / press calc depends on.
    expect(() =>
      transitionProductionTask(TaskStatus.PENDING, TaskStatus.COMPLETED),
    ).toThrow(InvalidTaskTransitionError);
  });

  it('throws on any outbound move from a terminal state', () => {
    for (const target of Object.values(TaskStatus)) {
      if (target === TaskStatus.CANCELLED) continue;
      expect(() =>
        transitionProductionTask(TaskStatus.CANCELLED, target),
      ).toThrow(InvalidTaskTransitionError);
    }
  });

  it('rejects self-transitions (no idempotent cancel or self-complete)', () => {
    // CANCELLED → CANCELLED looks harmless but opens a footgun:
    // callers can re-run a "cancel" action and get silent success
    // while the task was actually still active under a different
    // concurrent write. Demand a real transition so duplicates surface.
    for (const s of Object.values(TaskStatus)) {
      expect(() => transitionProductionTask(s, s)).toThrow(
        InvalidTaskTransitionError,
      );
    }
  });
});

describe('canTransitionProductionTask / isTerminalTaskStatus', () => {
  it('returns false for illegal moves without throwing', () => {
    expect(canTransitionProductionTask(TaskStatus.COMPLETED, TaskStatus.PENDING)).toBe(
      false,
    );
  });

  it('flags terminal states correctly', () => {
    expect(isTerminalTaskStatus(TaskStatus.PENDING)).toBe(false);
    expect(isTerminalTaskStatus(TaskStatus.IN_PROGRESS)).toBe(false);
    expect(isTerminalTaskStatus(TaskStatus.COMPLETED)).toBe(true);
    expect(isTerminalTaskStatus(TaskStatus.CANCELLED)).toBe(true);
  });
});
