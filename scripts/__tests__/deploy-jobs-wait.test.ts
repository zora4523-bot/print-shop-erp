import { describe, expect, it } from 'vitest';
import * as gate from '../deploy-jobs-gate.mjs';

function health(status = 'CONNECTED', overrides: Record<string, unknown> = {}) {
  return {
    smartBot: {
      status,
      required: true,
      configurationValid: true,
      identityMatch: true,
      operational: status === 'CONNECTED',
      recoveryWaitMs: 0,
      ...overrides,
    },
  };
}

async function simulate(observe: (elapsedMs: number) => unknown) {
  let elapsedMs = 0;
  const result = await gate.waitForDeployJobsGate({
    readHealth: async () => observe(elapsedMs),
    nowMs: () => elapsedMs,
    sleep: async (durationMs: number) => { elapsedMs += durationMs; },
  });
  return { result, elapsedMs };
}

describe('bounded deploy recovery observation', () => {
  it('accepts an ordinary release only after six continuous connected seconds', async () => {
    const { result, elapsedMs } = await simulate(() => health());
    expect(result.ok).toBe(true);
    expect(elapsedMs).toBe(6_000);
  });

  it('waits for a crashed worker heartbeat to expire instead of failing at 120 seconds', async () => {
    const { result, elapsedMs } = await simulate((at) => at <= 180_000
      ? health('CONNECTED', { operational: false, recoveryWaitMs: 180_000 - at })
      : health());
    expect(result.ok).toBe(true);
    expect(elapsedMs).toBe(188_000);
  });

  it('gives a newly observed transient near the old deadline its own recovery budget', async () => {
    const { result, elapsedMs } = await simulate((at) => {
      if (at < 118_000) return {};
      if (at <= 298_000) {
        return health('CONNECTING', { recoveryWaitMs: 298_000 - at });
      }
      return health();
    });
    expect(result.ok).toBe(true);
    expect(elapsedMs).toBe(306_000);
  });

  it('extends an existing recovery period when another restart occurs near its deadline', async () => {
    const { result, elapsedMs } = await simulate((at) => {
      if (at < 268_000) return health('CONNECTING');
      if (at <= 448_000) {
        return health('CONNECTED', { operational: false, recoveryWaitMs: 448_000 - at });
      }
      return health();
    });
    expect(result.ok).toBe(true);
    expect(elapsedMs).toBe(456_000);
  });

  it('never accepts two real workers that keep refreshing their heartbeats', async () => {
    const { result, elapsedMs } = await simulate(() => health('CONNECTED', {
      operational: false,
      recoveryWaitMs: 180_000,
    }));
    expect(result).toMatchObject({ ok: false, reason: 'hard-timeout' });
    expect(elapsedMs).toBe(600_000);
  });

  it('bounds repeated restarts even when each one could recover later', async () => {
    const { result, elapsedMs } = await simulate((at) => health('CONNECTING', {
      recoveryWaitMs: 180_000 - (at % 100_000),
    }));
    expect(result).toMatchObject({ ok: false, reason: 'hard-timeout' });
    expect(elapsedMs).toBe(600_000);
  });

  it('ends a single unrecovered connection episode after its finite recovery budget', async () => {
    const { result, elapsedMs } = await simulate(() => health('DISCONNECTED'));
    expect(result).toMatchObject({ ok: false, reason: 'recovery-timeout' });
    expect(elapsedMs).toBe(270_000);
  });

  it('does not extend the startup deadline for unobservable or identity-unknown responses', async () => {
    for (const body of [{}, health('CONNECTING', { identityMatch: null })]) {
      const { result, elapsedMs } = await simulate(() => body);
      expect(result).toMatchObject({ ok: false, reason: 'startup-timeout' });
      expect(elapsedMs).toBe(120_000);
    }
  });

  it.each([
    health('AUTH_FAILED'),
    health('CONNECTION_CONFLICT'),
    health('CONNECTED', { identityMatch: false }),
    health('CONNECTED', { configurationValid: false }),
    health('NOT_CONFIGURED'),
  ])('still immediately rejects a permanent failure %#', async (body) => {
    const { result, elapsedMs } = await simulate(() => body);
    expect(result.ok).toBe(false);
    expect(elapsedMs).toBe(0);
  });

  it('accepts an unneeded connector immediately', async () => {
    const { result, elapsedMs } = await simulate(() => health('NOT_CONFIGURED', {
      required: false, identityMatch: null, operational: true,
    }));
    expect(result.ok).toBe(true);
    expect(elapsedMs).toBe(0);
  });

  it('resets stable observation after an unreadable probe', async () => {
    const { result, elapsedMs } = await simulate((at) => at === 4_000 ? {} : health());
    expect(result.ok).toBe(true);
    expect(elapsedMs).toBe(12_000);
  });

  it.each([Infinity, 180_001, -1, '180000'])('does not extend recovery using an invalid wait hint %s', async (hint) => {
    const { result, elapsedMs } = await simulate(() => health('CONNECTING', { recoveryWaitMs: hint }));
    expect(result.reason).toBe('recovery-timeout');
    expect(elapsedMs).toBe(270_000);
  });

  it('bounds unreadable/network failures without granting recovery', async () => {
    const { result, elapsedMs } = await simulate(() => { throw new Error('offline'); });
    expect(result.reason).toBe('startup-timeout');
    expect(elapsedMs).toBe(120_000);
  });

  it('does not accept a probe that completes after the deadline', async () => {
    let elapsedMs = 119_000;
    const result = await gate.waitForDeployJobsGate({
      nowMs: () => elapsedMs,
      readHealth: async ({ timeoutMs }) => {
        expect(timeoutMs).toBeLessThanOrEqual(5_000);
        elapsedMs += 120_001;
        return health();
      },
    });
    expect(result).toMatchObject({ ok: false, reason: 'startup-timeout' });
  });

  it.each([
    { recoveryBudgetMs: 120_000 },
    { hardLimitMs: 120_000 },
    { hardLimitMs: 601_000 },
    { intervalMs: 0 },
    { settleMs: -1 },
  ])('rejects unsafe duration overrides %#', async (overrides) => {
    await expect(gate.waitForDeployJobsGate({
      readHealth: async () => health(), ...overrides,
    })).rejects.toThrow();
  });
});
