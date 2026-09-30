import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbDisconnectMock,
  runBackgroundWorkerMock,
  startWorkerHeartbeatMock,
  stopHeartbeatMock,
  startSmartBotMock,
  stopSmartBotMock,
} = vi.hoisted(() => ({
  dbDisconnectMock: vi.fn(async () => undefined),
  runBackgroundWorkerMock: vi.fn<
    (input: unknown) => Promise<void>
  >(),
  startWorkerHeartbeatMock: vi.fn<
    (input: unknown) => Promise<() => Promise<void>>
  >(),
  stopHeartbeatMock: vi.fn(async () => undefined),
  startSmartBotMock: vi.fn(),
  stopSmartBotMock: vi.fn(async () => undefined),
}));

const pdfMocks = vi.hoisted(() => ({ check: vi.fn(), enable: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/pdf/preflight', () => ({ checkPdfRuntime: pdfMocks.check }));
vi.mock('@/lib/pdf/render', () => ({ enableWorkerPdfBrowserReuse: pdfMocks.enable, closeWorkerPdfBrowser: pdfMocks.close }));
vi.mock('@/lib/background-jobs/handlers-heavy', () => ({ heavyBackgroundJobHandlers: {} }));
vi.mock('@/lib/db', () => ({
  db: { $disconnect: dbDisconnectMock },
}));
vi.mock('@/lib/background-jobs/heartbeat', () => ({
  startWorkerHeartbeat: startWorkerHeartbeatMock,
}));
vi.mock('@/lib/background-jobs/worker', () => ({
  runBackgroundWorker: runBackgroundWorkerMock,
}));
vi.mock('@/lib/background-jobs/handlers-light', () => ({
  lightBackgroundJobHandlers: {},
}));
vi.mock('@/lib/notification/smart-bot', () => ({
  SmartBotConnectorFatalKind: {
    AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
    CONNECTION_CONFLICT: 'CONNECTION_CONFLICT',
  },
  configuredSmartBotIdDigest: () => 'a'.repeat(64),
  startWecomSmartBotConnector: startSmartBotMock,
  stopWecomSmartBotConnector: stopSmartBotMock,
}));
vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));

import * as Sentry from '@sentry/nextjs';
import { runBackgroundWorkerProcess } from '../background-worker-runtime';
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '../../lib/observability/sentry-scrub';
import { WORKER_HEARTBEAT_MAX_INTERVAL_MS } from '../../lib/background-jobs/heartbeat-policy';

type SignalHandler = () => void;
type HeartbeatInput = {
  intervalMs?: number;
  smartBotStatus?: () => string | null;
  smartBotBotDigest?: () => string | null;
};
type WorkerInput = {
  signal?: AbortSignal;
};
type ConnectorOptions = {
  onStatusChange?: (status: string) => void;
  onFatal?: (error: { kind: string }) => void;
};

let signalHandlers: Map<string, SignalHandler>;
let initialExitCode: typeof process.exitCode;

beforeEach(() => {
  initialExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.stubEnv('BACKGROUND_JOB_QUEUE', 'LIGHT');
  vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test_worker');
  vi.stubEnv('DATABASE_POOL_MAX', '5');
  vi.stubEnv('LIGHT_WORKER_CONCURRENCY', '2');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NOTIFICATION_MOCK_MODE', 'false');
  vi.stubEnv('WECOM_SMART_BOT_ID', 'bot-id-placeholder');
  vi.stubEnv('WECOM_SMART_BOT_SECRET', 'rotated-secret-placeholder');
  vi.stubEnv('SENTRY_DSN', '');

  signalHandlers = new Map();
  vi.spyOn(process, 'once').mockImplementation(((
    signal: string,
    handler: SignalHandler,
  ) => {
    signalHandlers.set(signal, handler);
    return process;
  }) as typeof process.once);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  dbDisconnectMock.mockClear();
  runBackgroundWorkerMock.mockReset().mockResolvedValue(undefined);
  stopHeartbeatMock.mockClear();
  startWorkerHeartbeatMock
    .mockReset()
    .mockResolvedValue(stopHeartbeatMock);
  startSmartBotMock.mockReset();
  stopSmartBotMock.mockClear();
});

afterEach(() => {
  process.exitCode = initialExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('LIGHT worker smart-bot isolation', () => {
  it('accepts the maximum heartbeat interval covered by the health window', async () => {
    vi.stubEnv(
      'WORKER_HEARTBEAT_MS',
      String(WORKER_HEARTBEAT_MAX_INTERVAL_MS),
    );

    await runBackgroundWorkerProcess();

    expect(startWorkerHeartbeatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: WORKER_HEARTBEAT_MAX_INTERVAL_MS,
      }),
    );
    const heartbeatInput = startWorkerHeartbeatMock.mock.calls[0]?.[0] as
      | HeartbeatInput
      | undefined;
    expect(heartbeatInput?.smartBotBotDigest?.()).toBe('a'.repeat(64));
  });

  it('keeps the shared LIGHT queue running after terminal authentication failure', async () => {
    let heartbeatInput: HeartbeatInput | undefined;
    startWorkerHeartbeatMock.mockImplementationOnce(async (input) => {
      heartbeatInput = input as HeartbeatInput;
      return stopHeartbeatMock;
    });
    startSmartBotMock.mockImplementationOnce(
      (_env: NodeJS.ProcessEnv, options: ConnectorOptions) => {
        options.onStatusChange?.('AUTH_FAILED');
        options.onFatal?.({ kind: 'AUTHENTICATION_FAILED' });
      },
    );
    runBackgroundWorkerMock.mockImplementationOnce(async (input: unknown) => {
      expect((input as WorkerInput).signal?.aborted).toBe(false);
      expect(heartbeatInput?.smartBotStatus?.()).toBe('AUTH_FAILED');
    });

    await runBackgroundWorkerProcess();

    expect(runBackgroundWorkerMock).toHaveBeenCalledOnce();
    expect(stopHeartbeatMock).toHaveBeenCalledOnce();
    expect(stopSmartBotMock).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it('fail-stops only after connection ownership is lost and waits for shutdown', async () => {
    startSmartBotMock.mockImplementationOnce(
      (_env: NodeJS.ProcessEnv, options: ConnectorOptions) => {
        options.onStatusChange?.('CONNECTION_CONFLICT');
        options.onFatal?.({ kind: 'CONNECTION_CONFLICT' });
      },
    );
    runBackgroundWorkerMock.mockImplementationOnce(async (input: unknown) => {
      expect((input as WorkerInput).signal?.aborted).toBe(true);
    });

    const running = runBackgroundWorkerProcess();
    await vi.waitFor(() => expect(stopHeartbeatMock).toHaveBeenCalledOnce());
    expect(stopSmartBotMock).not.toHaveBeenCalled();

    signalHandlers.get('SIGTERM')?.();
    await running;

    expect(stopHeartbeatMock).toHaveBeenCalledOnce();
    expect(stopSmartBotMock).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });
});

it('refuses lane concurrency that would exhaust independent heartbeat connections', async () => {
  vi.stubEnv('LIGHT_WORKER_CONCURRENCY', '3');
  await runBackgroundWorkerProcess();
  expect(process.exitCode).toBe(1);
  expect(runBackgroundWorkerMock).not.toHaveBeenCalled();
  expect(startWorkerHeartbeatMock).not.toHaveBeenCalled();
});

describe('worker Sentry scrubbing', () => {
  it('installs the shared event, transaction and breadcrumb scrubbers', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://public@sentry.example/1');
    vi.mocked(Sentry.init).mockClear();

    await runBackgroundWorkerProcess();

    expect(Sentry.init).toHaveBeenCalledOnce();
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@sentry.example/1',
        sendDefaultPii: false,
        beforeSend: scrubSentryEvent,
        beforeSendTransaction: scrubSentryEvent,
        beforeBreadcrumb: scrubSentryBreadcrumb,
      }),
    );
  });
});

it('does not advertise a HEAVY heartbeat or consume jobs if PDF preflight fails', async () => {
  vi.stubEnv('BACKGROUND_JOB_QUEUE', 'HEAVY');
  pdfMocks.check.mockRejectedValueOnce(new Error('preflight'));
  await runBackgroundWorkerProcess();
  expect(process.exitCode).toBe(1);
  expect(startWorkerHeartbeatMock).not.toHaveBeenCalled();
  expect(runBackgroundWorkerMock).not.toHaveBeenCalled();
});
it('checks PDF before heartbeat and closes the reused browser after draining', async () => {
  vi.stubEnv('BACKGROUND_JOB_QUEUE', 'HEAVY');
  pdfMocks.check.mockResolvedValueOnce({ bytes: 1234 });
  await runBackgroundWorkerProcess();
  expect(pdfMocks.check).toHaveBeenCalledBefore(startWorkerHeartbeatMock);
  expect(pdfMocks.enable).toHaveBeenCalledOnce();
  expect(pdfMocks.close).toHaveBeenCalledAfter(runBackgroundWorkerMock);
});
