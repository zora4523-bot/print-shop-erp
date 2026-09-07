import 'server-only';

import { createHash } from 'node:crypto';
import { WSAuthFailureError, WSClient } from '@wecom/aibot-node-sdk';
import type { NotificationSmartBotChatType } from '../../generated/prisma/enums';
import { assertExecutionFence } from '../execution-fence';
import { db } from '../db';
import { isWecomMarkdownWithinLimit } from './limits';
import { waitForSmartBotSendSlot } from './smart-bot-throttle';
import type { WebhookResult } from './webhook';
import { smartBotIdDigest } from './smart-bot-identity';

export {
  configuredSmartBotIdDigest,
  smartBotCredentialsConfigured,
  smartBotIdDigest,
} from './smart-bot-identity';

const AUTH_WAIT_MS = 15_000;
const MAX_CONCURRENT_BINDING_TASKS = 2;
const MAX_QUEUED_BINDING_TASKS = 64;
const BINDING_CODE_PATTERN = /^ERP-BIND-[A-Za-z0-9_-]{32}$/;
const RETRYABLE_WECOM_ERRCODES: ReadonlySet<number> = new Set([
  -1,
  45009,
  45033,
  846607,
  846609,
]);

const ERROR = {
  notConfigured: 'wecom smart bot credentials not configured',
  credentialsIncomplete: 'wecom smart bot credentials incomplete',
  notAuthenticated: 'wecom smart bot not authenticated',
  connectionConflict: 'wecom smart bot duplicate connection detected',
  invalidTarget: 'invalid wecom smart bot target',
  contentTooLong: 'wecom markdown content exceeds 4096 bytes',
  throttleUnavailable: 'smart bot throttle unavailable',
  preSendUnavailable: 'smart bot pre-send check unavailable',
  ackUnknown: 'wecom smart bot acknowledgement unavailable',
} as const;

type SmartBotCredentials =
  | { configured: false; incomplete: boolean }
  | { configured: true; botId: string; secret: string };

type AuthWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

export enum SmartBotConnectionStatus {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  AUTH_FAILED = 'AUTH_FAILED',
  CONNECTION_CONFLICT = 'CONNECTION_CONFLICT',
}

export enum SmartBotConnectorFatalKind {
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  CONNECTION_CONFLICT = 'CONNECTION_CONFLICT',
}

type ParsedBindingMessage = Readonly<{
  botId: string;
  chatId: string;
  msgId: string;
  code: string;
}>;

type SmartBotGeneration = {
  id: number;
  client: WSClient;
  botId: string;
  secret: string;
  authenticated: boolean;
  fatalKind: SmartBotConnectorFatalKind | null;
  stopping: boolean;
  status: SmartBotConnectionStatus;
  waiters: Set<AuthWaiter>;
  bindingTasks: Set<Promise<void>>;
  bindingQueue: ParsedBindingMessage[];
  pendingBindingMessageIds: Set<string>;
  activeBindingTasks: number;
  bindingQueueOverflowLogged: boolean;
  bindingAbortController: AbortController;
  onFatal: ((error: SmartBotConnectorFatalError) => void) | null;
  onStatusChange: ((status: SmartBotConnectionStatus) => void) | null;
};

const runtime: {
  current: SmartBotGeneration | null;
  nextGenerationId: number;
} = {
  current: null,
  nextGenerationId: 1,
};

export type SmartBotConnectorOptions = {
  /** Reports terminal auth or ownership failures for queue-specific handling. */
  onFatal?: (error: SmartBotConnectorFatalError) => void;
  /** Receives redaction-safe lifecycle state changes for health reporting. */
  onStatusChange?: (status: SmartBotConnectionStatus) => void;
};

export class SmartBotConnectorFatalError extends Error {
  readonly kind: SmartBotConnectorFatalKind;

  constructor(kind: SmartBotConnectorFatalKind, message: string) {
    super(message);
    this.name = 'SmartBotConnectorFatalError';
    this.kind = kind;
  }
}

export type SmartBotTarget = Readonly<{
  targetId: string;
  chatType: NotificationSmartBotChatType;
}>;

export type PreparedSmartBotSend = Readonly<{
  kind: 'prepared-wecom-smart-bot-send';
}>;

type PreparedState = {
  generationId: number | null;
  botId: string | null;
  target: SmartBotTarget;
  content: string;
  result: WebhookResult | null;
};

const preparedSends = new WeakMap<PreparedSmartBotSend, PreparedState>();

export type SmartBotSender = (
  target: SmartBotTarget,
  content: string,
  options?: {
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
    beforeRequest?: () => Promise<boolean>;
    preparedSend?: PreparedSmartBotSend;
  },
) => Promise<WebhookResult>;

export function getSmartBotRuntimeStatus(): Readonly<{
  configured: boolean;
  started: boolean;
  authenticated: boolean;
  connectionConflict: boolean;
  fatalUnavailable: boolean;
  status: SmartBotConnectionStatus;
}> {
  const generation = runtime.current;
  const configured = Boolean(generation) || readCredentials().configured;
  return {
    configured,
    started: Boolean(generation),
    authenticated: generation?.authenticated ?? false,
    connectionConflict:
      generation?.fatalKind === SmartBotConnectorFatalKind.CONNECTION_CONFLICT,
    fatalUnavailable: Boolean(generation?.fatalKind),
    status:
      generation?.status ??
      (configured
        ? SmartBotConnectionStatus.DISCONNECTED
        : SmartBotConnectionStatus.NOT_CONFIGURED),
  };
}

/**
 * Starts the one process-owned connection. Call this only from the single
 * LIGHT worker; Web/Server Actions enqueue work and must never call it.
 */
export function startWecomSmartBotConnector(
  env: NodeJS.ProcessEnv = process.env,
  options: SmartBotConnectorOptions = {},
): void {
  const credentials = readCredentials(env);
  if (!credentials.configured) {
    notifyStatusChange(
      options.onStatusChange ?? null,
      credentials.incomplete
        ? SmartBotConnectionStatus.AUTH_FAILED
        : SmartBotConnectionStatus.NOT_CONFIGURED,
    );
    return;
  }
  if (notificationMockMode(env)) {
    notifyStatusChange(
      options.onStatusChange ?? null,
      SmartBotConnectionStatus.DISCONNECTED,
    );
    return;
  }
  const existing = runtime.current;
  if (existing) {
    if (existing.botId !== credentials.botId) {
      throw new Error('wecom smart bot connector already owns another bot');
    }
    return;
  }

  const client = createSmartBotClient(credentials.botId, credentials.secret);
  const generation: SmartBotGeneration = {
    id: runtime.nextGenerationId++,
    client,
    botId: credentials.botId,
    secret: credentials.secret,
    authenticated: false,
    fatalKind: null,
    stopping: false,
    status: SmartBotConnectionStatus.CONNECTING,
    waiters: new Set(),
    bindingTasks: new Set(),
    bindingQueue: [],
    pendingBindingMessageIds: new Set(),
    activeBindingTasks: 0,
    bindingQueueOverflowLogged: false,
    bindingAbortController: new AbortController(),
    onFatal: options.onFatal ?? null,
    onStatusChange: options.onStatusChange ?? null,
  };
  runtime.current = generation;
  attachSmartBotClientHandlers(generation, client);

  notifyStatusChange(
    generation.onStatusChange,
    SmartBotConnectionStatus.CONNECTING,
  );
  // A lifecycle observer may synchronously stop the connector. Do not create an
  // orphan socket after ownership has already moved to another generation.
  if (!isCurrentGeneration(generation) || generation.stopping) return;
  client.connect();
}

export async function stopWecomSmartBotConnector(): Promise<void> {
  const generation = runtime.current;
  if (!generation) return;

  // Detach first so a new generation can start while this generation drains.
  // Everything below is generation-owned and must never clear new state.
  runtime.current = null;
  generation.stopping = true;
  generation.authenticated = false;
  generation.status = SmartBotConnectionStatus.DISCONNECTED;
  const stopped = new Error('wecom smart bot connector stopped');
  generation.bindingAbortController.abort(stopped);
  clearQueuedBindingMessages(generation);
  rejectAuthWaiters(generation, stopped);
  generation.client.disconnect();
  notifyStatusChange(
    generation.onStatusChange,
    SmartBotConnectionStatus.DISCONNECTED,
  );
  const bindingTasks = [...generation.bindingTasks];
  await Promise.allSettled(bindingTasks);
  generation.bindingTasks.clear();
}

export async function prepareSmartBotSend(
  target: SmartBotTarget,
  content: string,
  options: { signal?: AbortSignal } = {},
): Promise<PreparedSmartBotSend> {
  options.signal?.throwIfAborted();
  const generation = runtime.current;
  const validation = validateSend(target, content);
  if (validation) {
    return preparedSend(
      target,
      content,
      generation?.id ?? null,
      generation?.botId ?? null,
      validation,
    );
  }
  if (generation?.fatalKind) {
    return preparedSend(target, content, generation.id, generation.botId, {
      ok: false,
      retries: 0,
      errorMessage:
        generation.fatalKind === SmartBotConnectorFatalKind.CONNECTION_CONFLICT
        ? ERROR.connectionConflict
        : ERROR.notAuthenticated,
      retryable: true,
    });
  }
  if (!generation) {
    return preparedSend(target, content, null, null, {
      ok: false,
      retries: 0,
      errorMessage: readCredentials().configured
        ? ERROR.notAuthenticated
        : ERROR.notConfigured,
      // Missing/temporarily incomplete credentials are an operator-recoverable
      // outage. A durable notification must remain RETRYING so restoring the
      // secret cannot silently strand the message in permanent FAILED.
      retryable: true,
    });
  }

  try {
    await waitForAuthentication(generation, options.signal);
    await waitForSmartBotSendSlot(
      generation.botId,
      target.chatType,
      target.targetId,
      options.signal ? { signal: options.signal } : {},
    );
    await waitForAuthentication(generation, options.signal);
  } catch (error) {
    if (options.signal?.aborted && error === options.signal.reason) throw error;
    return preparedSend(target, content, generation.id, generation.botId, {
      ok: false,
      retries: 0,
      errorMessage:
        generation.fatalKind === SmartBotConnectorFatalKind.CONNECTION_CONFLICT
        ? ERROR.connectionConflict
        : error instanceof SmartBotAuthenticationWaitError
          ? ERROR.notAuthenticated
          : ERROR.throttleUnavailable,
      retryable: true,
    });
  }
  return preparedSend(target, content, generation.id, generation.botId, null);
}

export const sendSmartBot: SmartBotSender = async (
  target,
  content,
  options,
) => {
  options?.signal?.throwIfAborted();
  const prepared =
    options?.preparedSend ??
    (await prepareSmartBotSend(
      target,
      content,
      options?.signal ? { signal: options.signal } : {},
    ));
  const state = preparedSends.get(prepared);
  preparedSends.delete(prepared);
  const generation = runtime.current;
  const preparedResult =
    !state ||
    state.generationId !== (generation?.id ?? null) ||
    state.botId !== (generation?.botId ?? null) ||
    state.target.targetId !== target.targetId ||
    state.target.chatType !== target.chatType ||
    state.content !== content
      ? ({
          ok: false,
          retries: 0,
          errorMessage: ERROR.preSendUnavailable,
          retryable: true,
        } satisfies WebhookResult)
      : state.result;

  try {
    await assertExecutionFence(options);
    if (options?.beforeRequest && !(await options.beforeRequest())) {
      return { ok: false, retries: 0, skipped: true };
    }
    options?.signal?.throwIfAborted();
  } catch (error) {
    if (options?.signal?.aborted && error === options.signal.reason) throw error;
    return {
      ok: false,
      retries: 0,
      errorMessage: ERROR.preSendUnavailable,
      retryable: true,
    };
  }

  // A stale business fact wins even when local validation/auth preparation
  // failed. This mirrors the webhook transport's terminal supersession rule.
  if (preparedResult) return preparedResult;
  if (
    !generation ||
    !generation.authenticated ||
    generation.fatalKind !== null
  ) {
    return {
      ok: false,
      retries: 0,
      errorMessage:
        generation?.fatalKind === SmartBotConnectorFatalKind.CONNECTION_CONFLICT
        ? ERROR.connectionConflict
        : ERROR.notAuthenticated,
      retryable: true,
    };
  }

  const client = generation.client;
  try {
    // sendMessage writes the frame synchronously before returning its ACK
    // promise. `chat_type` is accepted by the wire protocol even though SDK
    // 1.0.7's SendMsgBody type does not expose it yet.
    const ack = await client.sendMessage(target.targetId, {
      msgtype: 'markdown',
      markdown: { content },
      chat_type: target.chatType === 'GROUP' ? 2 : 1,
    } as Parameters<WSClient['sendMessage']>[1]);
    const errcode = ack.errcode;
    if (typeof errcode !== 'number' || !Number.isSafeInteger(errcode)) {
      return unknownAckResult();
    }
    if (errcode === 0) return { ok: true, retries: 0 };
    return handleProviderRejection(generation, client, errcode);
  } catch (error) {
    if (isProviderAck(error)) {
      return handleProviderRejection(generation, client, error.errcode);
    }
    if (isDefinitelyPreWriteDisconnect(error)) {
      return {
        ok: false,
        retries: 0,
        errorMessage: ERROR.notAuthenticated,
        retryable: true,
      };
    }
    // Timeout, disconnect cancellation, or any unexpected SDK failure after
    // sendMessage started cannot prove whether WeCom accepted the frame.
    return unknownAckResult();
  }
};

export const mockSmartBotSender: SmartBotSender = async (
  target,
  content,
  options,
) => {
  options?.signal?.throwIfAborted();
  try {
    await assertExecutionFence(options);
    if (options?.beforeRequest && !(await options.beforeRequest())) {
      return { ok: false, retries: 0, skipped: true };
    }
  } catch (error) {
    if (options?.signal?.aborted && error === options.signal.reason) throw error;
    return {
      ok: false,
      retries: 0,
      errorMessage: ERROR.preSendUnavailable,
      retryable: true,
    };
  }
  return validateSend(target, content) ?? { ok: true, retries: 0 };
};

export function hashSmartBotBindingCode(code: string): string {
  return createHash('sha256')
    .update('wecom-smart-bot-binding\0', 'utf8')
    .update(code, 'utf8')
    .digest('hex');
}

export function smartBotDestinationFingerprint(
  botId: string,
  target: SmartBotTarget,
): string {
  return createHash('sha256')
    .update('wecom-smart-bot-destination\0', 'utf8')
    .update(botId.trim(), 'utf8')
    .update('\0', 'utf8')
    .update(target.chatType, 'utf8')
    .update('\0', 'utf8')
    .update(target.targetId.trim(), 'utf8')
    .digest('hex');
}

function readCredentials(env: NodeJS.ProcessEnv = process.env): SmartBotCredentials {
  const botId = env.WECOM_SMART_BOT_ID?.trim() ?? '';
  const secret = env.WECOM_SMART_BOT_SECRET?.trim() ?? '';
  if (!botId || !secret) {
    return { configured: false, incomplete: Boolean(botId || secret) };
  }
  return { configured: true, botId, secret };
}

function notificationMockMode(env: NodeJS.ProcessEnv): boolean {
  if (env.NOTIFICATION_MOCK_MODE === 'true') return true;
  if (env.NOTIFICATION_MOCK_MODE === 'false') return false;
  return env.NODE_ENV !== 'production';
}

function preparedSend(
  target: SmartBotTarget,
  content: string,
  generationId: number | null,
  botId: string | null,
  result: WebhookResult | null,
): PreparedSmartBotSend {
  const prepared = Object.freeze({
    kind: 'prepared-wecom-smart-bot-send' as const,
  });
  preparedSends.set(prepared, {
    generationId,
    botId,
    target,
    content,
    result,
  });
  return prepared;
}

function validateSend(
  target: SmartBotTarget,
  content: string,
): WebhookResult | null {
  if (
    (target.chatType !== 'GROUP' && target.chatType !== 'SINGLE') ||
    !target.targetId.trim() ||
    target.targetId.length > 512
  ) {
    return {
      ok: false,
      retries: 0,
      errorMessage: ERROR.invalidTarget,
      retryable: false,
    };
  }
  if (!isWecomMarkdownWithinLimit(content)) {
    return {
      ok: false,
      retries: 0,
      errorMessage: ERROR.contentTooLong,
      retryable: false,
    };
  }
  return null;
}

function providerRejection(code: number): WebhookResult {
  return {
    ok: false,
    retries: 0,
    errorMessage: `wecom smart bot errcode ${code}`,
    retryable: RETRYABLE_WECOM_ERRCODES.has(code),
  };
}

function handleProviderRejection(
  generation: SmartBotGeneration,
  client: WSClient,
  code: number,
): WebhookResult {
  if (code === 846609) {
    restartSmartBotSubscription(generation, client);
  }
  return providerRejection(code);
}

function unknownAckResult(): WebhookResult {
  return {
    ok: false,
    retries: 0,
    errorMessage: ERROR.ackUnknown,
    retryable: false,
    unknown: true,
  };
}

function isProviderAck(error: unknown): error is { errcode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    Number.isSafeInteger((error as { errcode?: unknown }).errcode)
  );
}

function isDefinitelyPreWriteDisconnect(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'WebSocket not connected, unable to send data'
  );
}

function createSmartBotClient(botId: string, secret: string): WSClient {
  return new WSClient({
    botId,
    secret,
    // Network failures recover indefinitely in the one elected worker. Auth
    // failures stay bounded because retrying a bad Secret forever is noise.
    maxReconnectAttempts: -1,
    maxAuthFailureAttempts: 5,
    logger: redactedSdkLogger,
  });
}

function attachSmartBotClientHandlers(
  generation: SmartBotGeneration,
  client: WSClient,
): void {
  client.on('authenticated', () => {
    if (!isActiveSmartBotClient(generation, client) || generation.fatalKind) {
      return;
    }
    generation.authenticated = true;
    setConnectionStatus(generation, SmartBotConnectionStatus.CONNECTED);
    for (const waiter of generation.waiters) waiter.resolve();
    generation.waiters.clear();
    console.info('[wecom-smart-bot] authenticated');
  });
  client.on('disconnected', () => {
    if (!isActiveSmartBotClient(generation, client)) return;
    generation.authenticated = false;
    if (!generation.fatalKind) {
      setConnectionStatus(generation, SmartBotConnectionStatus.DISCONNECTED);
    }
    if (!generation.stopping) {
      console.warn('[wecom-smart-bot] connection unavailable');
    }
  });
  client.on('reconnecting', () => {
    if (!isActiveSmartBotClient(generation, client) || generation.fatalKind) {
      return;
    }
    generation.authenticated = false;
    setConnectionStatus(generation, SmartBotConnectionStatus.CONNECTING);
  });
  client.on('event.disconnected_event', () => {
    if (!isActiveSmartBotClient(generation, client)) return;
    markConnectorFatal(
      generation,
      SmartBotConnectorFatalKind.CONNECTION_CONFLICT,
      ERROR.connectionConflict,
    );
    console.error('[wecom-smart-bot] duplicate connection detected');
  });
  client.on('error', (error) => {
    if (!isActiveSmartBotClient(generation, client)) return;
    generation.authenticated = false;
    if (error instanceof WSAuthFailureError) {
      markConnectorFatal(
        generation,
        SmartBotConnectorFatalKind.AUTHENTICATION_FAILED,
        ERROR.notAuthenticated,
      );
    } else if (!generation.fatalKind) {
      setConnectionStatus(generation, SmartBotConnectionStatus.DISCONNECTED);
    }
    console.error(
      `[wecom-smart-bot] connection error: ${error instanceof Error ? error.name : 'UnknownError'}`,
    );
  });
  client.on('message.text', (frame) => {
    if (!isActiveSmartBotClient(generation, client) || generation.fatalKind) {
      return;
    }
    const bindingMessage = parseBindingMessage(frame, generation.botId);
    if (!bindingMessage) return;
    enqueueBindingMessage(generation, bindingMessage);
  });
}

function restartSmartBotSubscription(
  generation: SmartBotGeneration,
  sourceClient: WSClient,
): void {
  if (
    !isActiveSmartBotClient(generation, sourceClient) ||
    generation.stopping ||
    generation.fatalKind
  ) {
    return;
  }

  let replacementClient: WSClient;
  try {
    replacementClient = createSmartBotClient(generation.botId, generation.secret);
  } catch (error) {
    generation.authenticated = false;
    setConnectionStatus(generation, SmartBotConnectionStatus.CONNECTING);
    console.error(
      `[wecom-smart-bot] subscription recovery failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
    );
    reconnectSmartBotClient(generation, sourceClient);
    return;
  }

  // Swap ownership before disconnecting the stale SDK client. Some transports
  // emit `disconnected` synchronously; its late lifecycle/message events must
  // not overwrite the replacement client's state or trigger a false fatal.
  generation.authenticated = false;
  generation.client = replacementClient;
  attachSmartBotClientHandlers(generation, replacementClient);
  setConnectionStatus(generation, SmartBotConnectionStatus.CONNECTING);
  disconnectSmartBotClient(sourceClient);
  if (!isActiveSmartBotClient(generation, replacementClient)) return;
  connectSmartBotClient(generation, replacementClient);
}

function reconnectSmartBotClient(
  generation: SmartBotGeneration,
  client: WSClient,
): void {
  disconnectSmartBotClient(client);
  if (!isActiveSmartBotClient(generation, client)) return;
  connectSmartBotClient(generation, client);
}

function connectSmartBotClient(
  generation: SmartBotGeneration,
  client: WSClient,
): void {
  try {
    client.connect();
  } catch (error) {
    if (isActiveSmartBotClient(generation, client)) {
      generation.authenticated = false;
      setConnectionStatus(generation, SmartBotConnectionStatus.DISCONNECTED);
    }
    console.error(
      `[wecom-smart-bot] subscription recovery failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
    );
  }
}

function disconnectSmartBotClient(client: WSClient): void {
  try {
    client.disconnect();
  } catch (error) {
    console.error(
      `[wecom-smart-bot] stale connection cleanup failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
    );
  }
}

function isCurrentGeneration(generation: SmartBotGeneration): boolean {
  return runtime.current === generation;
}

function isActiveSmartBotClient(
  generation: SmartBotGeneration,
  client: WSClient,
): boolean {
  return isCurrentGeneration(generation) && generation.client === client;
}

function setConnectionStatus(
  generation: SmartBotGeneration,
  status: SmartBotConnectionStatus,
): void {
  if (!isCurrentGeneration(generation) || generation.status === status) return;
  generation.status = status;
  notifyStatusChange(generation.onStatusChange, status);
}

function notifyStatusChange(
  callback: ((status: SmartBotConnectionStatus) => void) | null,
  status: SmartBotConnectionStatus,
): void {
  try {
    callback?.(status);
  } catch (error) {
    console.error(
      `[wecom-smart-bot] status callback failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
    );
  }
}

function markConnectorFatal(
  generation: SmartBotGeneration,
  kind: SmartBotConnectorFatalKind,
  message: string,
): void {
  if (!isCurrentGeneration(generation) || generation.fatalKind) return;
  generation.authenticated = false;
  generation.fatalKind = kind;
  const error = new SmartBotConnectorFatalError(kind, message);
  generation.bindingAbortController.abort(error);
  clearQueuedBindingMessages(generation);
  rejectAuthWaiters(generation, error);
  setConnectionStatus(
    generation,
    kind === SmartBotConnectorFatalKind.CONNECTION_CONFLICT
      ? SmartBotConnectionStatus.CONNECTION_CONFLICT
      : SmartBotConnectionStatus.AUTH_FAILED,
  );
  try {
    generation.onFatal?.(error);
  } catch (callbackError) {
    console.error(
      `[wecom-smart-bot] fatal callback failed: ${callbackError instanceof Error ? callbackError.name : 'UnknownError'}`,
    );
  }
}

async function waitForAuthentication(
  generation: SmartBotGeneration,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!isCurrentGeneration(generation)) {
    throw new SmartBotAuthenticationWaitError(ERROR.notAuthenticated);
  }
  if (generation.fatalKind === SmartBotConnectorFatalKind.CONNECTION_CONFLICT) {
    throw new SmartBotAuthenticationWaitError(ERROR.connectionConflict);
  }
  if (generation.fatalKind || generation.stopping) {
    throw new SmartBotAuthenticationWaitError(ERROR.notAuthenticated);
  }
  if (generation.authenticated) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      generation.waiters.delete(waiter);
      callback();
    };
    const waiter: AuthWaiter = {
      resolve: () => finish(resolve),
      reject: (error) => finish(() => reject(error)),
    };
    const onAbort = () => {
      try {
        signal?.throwIfAborted();
      } catch (error) {
        finish(() => reject(error));
      }
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new SmartBotAuthenticationWaitError(ERROR.notAuthenticated)),
        ),
      AUTH_WAIT_MS,
    );
    generation.waiters.add(waiter);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function rejectAuthWaiters(
  generation: SmartBotGeneration,
  error: Error,
): void {
  for (const waiter of generation.waiters) waiter.reject(error);
  generation.waiters.clear();
}

class SmartBotAuthenticationWaitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmartBotAuthenticationWaitError';
  }
}

type BindingFrame = {
  body?: {
    msgid?: unknown;
    aibotid?: unknown;
    chatid?: unknown;
    chattype?: unknown;
    msgtype?: unknown;
    text?: { content?: unknown };
  };
};

function parseBindingMessage(
  frame: BindingFrame,
  botId: string,
): ParsedBindingMessage | null {
  const body = frame.body;
  if (
    body?.msgtype !== 'text' ||
    body.chattype !== 'group' ||
    typeof body.chatid !== 'string' ||
    body.chatid.length === 0 ||
    body.chatid.length > 512 ||
    typeof body.msgid !== 'string' ||
    body.msgid.length === 0 ||
    body.msgid.length > 128 ||
    body.aibotid !== botId ||
    typeof body.text?.content !== 'string'
  ) {
    return null;
  }
  const code = extractBindingCode(body.text.content);
  if (!code) return null;
  return {
    botId,
    chatId: body.chatid,
    msgId: body.msgid,
    code,
  };
}

function extractBindingCode(content: string): string | null {
  // In a group, WeCom delivers the visible @bot prefix as part of text.content.
  // Accept one standalone binding token anywhere in that text while rejecting
  // ambiguous messages containing multiple codes or a longer lookalike token.
  const candidates = content.match(
    /(?<![A-Za-z0-9_-])ERP-BIND-[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/gu,
  );
  const candidate = candidates?.length === 1 ? candidates[0] : undefined;
  return candidate && BINDING_CODE_PATTERN.test(candidate) ? candidate : null;
}

function enqueueBindingMessage(
  generation: SmartBotGeneration,
  message: ParsedBindingMessage,
): void {
  if (
    !isCurrentGeneration(generation) ||
    generation.stopping ||
    generation.fatalKind ||
    generation.bindingAbortController.signal.aborted ||
    generation.pendingBindingMessageIds.has(message.msgId)
  ) {
    return;
  }
  if (generation.bindingQueue.length >= MAX_QUEUED_BINDING_TASKS) {
    if (!generation.bindingQueueOverflowLogged) {
      generation.bindingQueueOverflowLogged = true;
      console.warn('[wecom-smart-bot] binding callback queue full');
    }
    return;
  }
  generation.pendingBindingMessageIds.add(message.msgId);
  generation.bindingQueue.push(message);
  drainBindingQueue(generation);
}

function drainBindingQueue(generation: SmartBotGeneration): void {
  if (
    !isCurrentGeneration(generation) ||
    generation.stopping ||
    generation.fatalKind ||
    generation.bindingAbortController.signal.aborted
  ) {
    return;
  }
  while (
    generation.activeBindingTasks < MAX_CONCURRENT_BINDING_TASKS &&
    generation.bindingQueue.length > 0
  ) {
    const message = generation.bindingQueue.shift();
    if (!message) break;
    if (generation.bindingQueue.length === 0) {
      generation.bindingQueueOverflowLogged = false;
    }
    generation.activeBindingTasks += 1;
    const task = handleBindingMessage(
      message,
      generation,
      generation.bindingAbortController.signal,
    )
      .catch((error) => {
        if (generation.bindingAbortController.signal.aborted) return;
        console.error(
          `[wecom-smart-bot] binding callback failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
        );
      })
      .finally(() => {
        generation.bindingTasks.delete(task);
        generation.pendingBindingMessageIds.delete(message.msgId);
        generation.activeBindingTasks = Math.max(
          0,
          generation.activeBindingTasks - 1,
        );
        drainBindingQueue(generation);
      });
    generation.bindingTasks.add(task);
  }
}

function clearQueuedBindingMessages(generation: SmartBotGeneration): void {
  for (const message of generation.bindingQueue) {
    generation.pendingBindingMessageIds.delete(message.msgId);
  }
  generation.bindingQueue.length = 0;
  generation.bindingQueueOverflowLogged = false;
}

async function handleBindingMessage(
  message: ParsedBindingMessage,
  generation: SmartBotGeneration,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const { botId, chatId, msgId, code } = message;
  const botDigest = smartBotIdDigest(botId);
  const codeHash = hashSmartBotBindingCode(code);
  const result = await db.$transaction(async (tx) => {
    const nowRows = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    const now = nowRows[0]?.now;
    if (!now) throw new Error('database clock unavailable');

    const channel = await tx.notificationChannel.findFirst({
      where: {
        transport: 'WECOM_SMART_BOT',
        smartBotTargetId: null,
        smartBotBindingCodeHash: codeHash,
        smartBotBindingExpiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (!channel) return 'INVALID' as const;

    // Only a genuinely live binding code earns a durable receipt or a bot
    // response. Random lookalike codes are ignored, so they cannot grow the
    // receipt table or consume the conversation's outbound quota.
    const receipt = await tx.notificationSmartBotBindingReceipt.createMany({
      data: [{ botDigest, msgId }],
      skipDuplicates: true,
    });
    if (receipt.count === 0) return 'DUPLICATE' as const;

    const alreadyBound = await tx.notificationChannel.findFirst({
      where: { smartBotBotDigest: botDigest, smartBotTargetId: chatId },
      select: { id: true },
    });
    if (alreadyBound) {
      // Binding codes are one-shot even when sent to the wrong (already used)
      // group. The owner can explicitly generate a fresh code after reviewing.
      await tx.notificationChannel.updateMany({
        where: {
          id: channel.id,
          smartBotTargetId: null,
          smartBotBindingCodeHash: codeHash,
        },
        data: {
          smartBotBindingCodeHash: null,
          smartBotBindingExpiresAt: null,
        },
      });
      return 'TARGET_USED' as const;
    }

    const updated = await tx.notificationChannel.updateMany({
      where: {
        id: channel.id,
        transport: 'WECOM_SMART_BOT',
        smartBotTargetId: null,
        smartBotBindingCodeHash: codeHash,
        smartBotBindingExpiresAt: { gt: now },
      },
      data: {
        smartBotBotDigest: botDigest,
        smartBotTargetId: chatId,
        smartBotChatType: 'GROUP',
        smartBotBoundAt: now,
        smartBotBindingCodeHash: null,
        smartBotBindingExpiresAt: null,
        isActive: false,
      },
    });
    return updated.count === 1 ? ('BOUND' as const) : ('INVALID' as const);
  });

  signal.throwIfAborted();
  if (!isCurrentGeneration(generation)) {
    throw new SmartBotAuthenticationWaitError(ERROR.notAuthenticated);
  }
  if (result === 'DUPLICATE' || result === 'INVALID') return;
  const response =
    result === 'BOUND'
      ? '**ERP 通知群绑定成功**\n请回到 ERP 后台审核并启用该通知目标。'
      : result === 'TARGET_USED'
        ? '**绑定未完成**\n该企业微信群已绑定到另一个 ERP 通知目标。'
        : '**绑定码无效或已过期**\n请回到 ERP 后台重新生成绑定码。';

  const target: SmartBotTarget = { targetId: chatId, chatType: 'GROUP' };
  const prepared = await prepareSmartBotSend(target, response, { signal });
  const sendResult = await sendSmartBot(target, response, {
    signal,
    preparedSend: prepared,
  });
  if (!sendResult.ok) {
    console.warn('[wecom-smart-bot] binding acknowledgement unavailable');
  }
  if (result === 'BOUND') {
    console.info('[wecom-smart-bot] notification target bound');
  }
}

const redactedSdkLogger = {
  debug(): void {},
  info(): void {},
  warn(): void {
    console.warn('[wecom-smart-bot] sdk warning');
  },
  error(): void {
    console.error('[wecom-smart-bot] sdk error');
  },
};
