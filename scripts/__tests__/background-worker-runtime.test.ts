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

import { runBackgroundWorkerProcess } from '../background-worker-runtime';
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
