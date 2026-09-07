import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sdkMock, waitForSlotMock, dbMock } = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  class FakeWSClient {
    handlers = new Map<string, Handler[]>();
    sendMessage = vi.fn(async () => ({ errcode: 0 }));
    disconnect = vi.fn();
    connect = vi.fn(() => this);

    constructor(public readonly options: Record<string, unknown>) {
      sdk.instances.push(this);
    }

    on(event: string, handler: Handler): this {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
  }
  class FakeWSAuthFailureError extends Error {}
  const sdk = {
    instances: [] as FakeWSClient[],
    FakeWSClient,
    FakeWSAuthFailureError,
  };
  return {
    sdkMock: sdk,
    waitForSlotMock: vi.fn(),
    dbMock: { $transaction: vi.fn() },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@wecom/aibot-node-sdk', () => ({
  WSClient: sdkMock.FakeWSClient,
  WSAuthFailureError: sdkMock.FakeWSAuthFailureError,
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/smart-bot-throttle', () => ({
  waitForSmartBotSendSlot: waitForSlotMock,
}));

import {
  getSmartBotRuntimeStatus,
  prepareSmartBotSend,
  sendSmartBot,
  SmartBotConnectionStatus,
  SmartBotConnectorFatalKind,
  startWecomSmartBotConnector,
  stopWecomSmartBotConnector,
} from '../smart-bot';

const target = { targetId: 'group-chat-1', chatType: 'GROUP' } as const;
const credentials = {
  NODE_ENV: 'production',
  NOTIFICATION_MOCK_MODE: 'false',
  WECOM_SMART_BOT_ID: 'bot-id-placeholder',
  WECOM_SMART_BOT_SECRET: 'rotated-secret-placeholder',
} as NodeJS.ProcessEnv;

function bindingFrame(msgId: string, codeCharacter = 'A') {
  return {
    body: {
      msgid: msgId,
      aibotid: 'bot-id-placeholder',
      chatid: 'group-chat-1',
      chattype: 'group',
      msgtype: 'text',
      text: {
        content: `@ERP智能机器人 ERP-BIND-${codeCharacter.repeat(32)}`,
      },
    },
  };
}

beforeEach(async () => {
  await stopWecomSmartBotConnector();
  sdkMock.instances.length = 0;
  waitForSlotMock.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset();
});

afterEach(async () => {
  await stopWecomSmartBotConnector();
  vi.restoreAllMocks();
});

async function authenticatedClient(options = {}) {
  startWecomSmartBotConnector(credentials, options);
  const client = sdkMock.instances[0];
  expect(client).toBeDefined();
  client.emit('authenticated');
  return client;
}

describe('WeCom smart-bot transport', () => {
  it('reports missing and partial credentials without starting or throwing', () => {
    const missingStatus = vi.fn();
    const partialStatus = vi.fn();

    expect(() =>
      startWecomSmartBotConnector(
        {
          ...credentials,
          WECOM_SMART_BOT_ID: '',
          WECOM_SMART_BOT_SECRET: '',
        },
        { onStatusChange: missingStatus },
      ),
    ).not.toThrow();
    expect(missingStatus).toHaveBeenCalledExactlyOnceWith(
      SmartBotConnectionStatus.NOT_CONFIGURED,
    );

    expect(() =>
      startWecomSmartBotConnector(
        { ...credentials, WECOM_SMART_BOT_SECRET: '' },
        { onStatusChange: partialStatus },
      ),
    ).not.toThrow();
    expect(partialStatus).toHaveBeenCalledExactlyOnceWith(
      SmartBotConnectionStatus.AUTH_FAILED,
    );
    expect(sdkMock.instances).toHaveLength(0);
  });

  it('keeps a missing credential outage retryable for durable recovery', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', '');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', '');

    const prepared = await prepareSmartBotSend(target, 'test');

    await expect(
      sendSmartBot(target, 'test', { preparedSend: prepared }),
    ).resolves.toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'wecom smart bot credentials not configured',
      retryable: true,
    });
  });

  it('owns one connection and sends an explicit group chat_type after auth', async () => {
    const onStatusChange = vi.fn();
    const client = await authenticatedClient({ onStatusChange });
    startWecomSmartBotConnector(credentials);
    expect(sdkMock.instances).toHaveLength(1);
    expect(onStatusChange).toHaveBeenNthCalledWith(
      1,
      SmartBotConnectionStatus.CONNECTING,
    );
    expect(onStatusChange).toHaveBeenNthCalledWith(
      2,
      SmartBotConnectionStatus.CONNECTED,
    );
    expect(getSmartBotRuntimeStatus()).toMatchObject({
      status: SmartBotConnectionStatus.CONNECTED,
      authenticated: true,
    });

    const prepared = await prepareSmartBotSend(target, '**test**');
    await expect(
      sendSmartBot(target, '**test**', { preparedSend: prepared }),
    ).resolves.toEqual({ ok: true, retries: 0 });

    expect(waitForSlotMock).toHaveBeenCalledWith(
      'bot-id-placeholder',
      'GROUP',
      'group-chat-1',
      {},
    );
    expect(client.sendMessage).toHaveBeenCalledExactlyOnceWith(
      'group-chat-1',
      {
        msgtype: 'markdown',
        markdown: { content: '**test**' },
        chat_type: 2,
      },
    );

    client.emit('disconnected');
    expect(onStatusChange).toHaveBeenLastCalledWith(
      SmartBotConnectionStatus.DISCONNECTED,
    );
    client.emit('reconnecting');
    expect(onStatusChange).toHaveBeenLastCalledWith(
      SmartBotConnectionStatus.CONNECTING,
    );
    client.emit('authenticated');
    expect(onStatusChange).toHaveBeenLastCalledWith(
      SmartBotConnectionStatus.CONNECTED,
    );
  });

  it.each([
    [-1, true],
    [45009, true],
    [45033, true],
    [846607, true],
    [846609, true],
    [40008, false],
  ])('classifies provider errcode %i as retryable=%s', async (errcode, retryable) => {
    const client = await authenticatedClient();
    client.sendMessage.mockRejectedValueOnce({ errcode, errmsg: 'redacted' });
    const prepared = await prepareSmartBotSend(target, 'test');

    await expect(
      sendSmartBot(target, 'test', { preparedSend: prepared }),
    ).resolves.toEqual({
      ok: false,
      retries: 0,
      errorMessage: `wecom smart bot errcode ${errcode}`,
      retryable,
    });
  });

  it('rebuilds a missing subscription and isolates every late event from the stale client', async () => {
    const onFatal = vi.fn();
    const onStatusChange = vi.fn();
    const staleClient = await authenticatedClient({ onFatal, onStatusChange });
    staleClient.sendMessage.mockRejectedValueOnce({
      errcode: 846609,
      errmsg: 'redacted',
    });
    const prepared = await prepareSmartBotSend(target, 'first');

    await expect(
      sendSmartBot(target, 'first', { preparedSend: prepared }),
    ).resolves.toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'wecom smart bot errcode 846609',
      retryable: true,
    });

    expect(sdkMock.instances).toHaveLength(2);
    const replacementClient = sdkMock.instances[1];
    expect(replacementClient).toBeDefined();
    expect(staleClient.disconnect).toHaveBeenCalledOnce();
    expect(replacementClient.connect).toHaveBeenCalledOnce();
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      SmartBotConnectionStatus.CONNECTING,
      SmartBotConnectionStatus.CONNECTED,
      SmartBotConnectionStatus.CONNECTING,
    ]);
    expect(getSmartBotRuntimeStatus()).toMatchObject({
      status: SmartBotConnectionStatus.CONNECTING,
      authenticated: false,
      fatalUnavailable: false,
    });

    staleClient.emit('authenticated');
    staleClient.emit('disconnected');
    staleClient.emit('reconnecting');
    staleClient.emit(
      'error',
      new sdkMock.FakeWSAuthFailureError('stale auth failure'),
    );
    staleClient.emit('event.disconnected_event', {});
    staleClient.emit('message.text', bindingFrame('stale-client-message'));

    expect(getSmartBotRuntimeStatus()).toMatchObject({
      status: SmartBotConnectionStatus.CONNECTING,
      authenticated: false,
      fatalUnavailable: false,
    });
    expect(onFatal).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledTimes(3);
    expect(dbMock.$transaction).not.toHaveBeenCalled();

    replacementClient.emit('authenticated');
    expect(onStatusChange).toHaveBeenLastCalledWith(
      SmartBotConnectionStatus.CONNECTED,
    );
    const recovered = await prepareSmartBotSend(target, 'second');
    await expect(
      sendSmartBot(target, 'second', { preparedSend: recovered }),
    ).resolves.toEqual({ ok: true, retries: 0 });
    expect(replacementClient.sendMessage).toHaveBeenCalledExactlyOnceWith(
      'group-chat-1',
      expect.objectContaining({ markdown: { content: 'second' } }),
    );
  });

  it('retries a definitive pre-write disconnect but marks ambiguous ACKs UNKNOWN', async () => {
    const client = await authenticatedClient();
    client.sendMessage.mockRejectedValueOnce(
      new Error('WebSocket not connected, unable to send data'),
    );
    let prepared = await prepareSmartBotSend(target, 'first');
    await expect(
      sendSmartBot(target, 'first', { preparedSend: prepared }),
    ).resolves.toMatchObject({ ok: false, retryable: true });

    client.sendMessage.mockRejectedValueOnce(new Error('Reply ack timeout'));
    prepared = await prepareSmartBotSend(target, 'second');
    await expect(
      sendSmartBot(target, 'second', { preparedSend: prepared }),
    ).resolves.toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'wecom smart bot acknowledgement unavailable',
      retryable: false,
      unknown: true,
    });

    client.sendMessage.mockResolvedValueOnce({} as { errcode: number });
    prepared = await prepareSmartBotSend(target, 'third');
    await expect(
      sendSmartBot(target, 'third', { preparedSend: prepared }),
    ).resolves.toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'wecom smart bot acknowledgement unavailable',
      retryable: false,
      unknown: true,
    });
  });

  it('fails closed after another process takes over the same Bot ID', async () => {
    const onFatal = vi.fn();
    const onStatusChange = vi.fn();
    const client = await authenticatedClient({ onFatal, onStatusChange });
    client.emit('event.disconnected_event', {});
    const prepared = await prepareSmartBotSend(target, 'test');

    await expect(
      sendSmartBot(target, 'test', { preparedSend: prepared }),
    ).resolves.toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'wecom smart bot duplicate connection detected',
      retryable: true,
    });
    expect(onFatal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'SmartBotConnectorFatalError',
        kind: SmartBotConnectorFatalKind.CONNECTION_CONFLICT,
      }),
    );
    expect(onStatusChange).toHaveBeenLastCalledWith(
      SmartBotConnectionStatus.CONNECTION_CONFLICT,
    );
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('reports exhausted authentication separately from connection ownership loss', async () => {
    const onFatal = vi.fn();
    const onStatusChange = vi.fn();
    startWecomSmartBotConnector(credentials, { onFatal, onStatusChange });
    const client = sdkMock.instances[0];

    client.emit('error', new sdkMock.FakeWSAuthFailureError('redacted'));

    expect(onFatal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'SmartBotConnectorFatalError',
        kind: SmartBotConnectorFatalKind.AUTHENTICATION_FAILED,
      }),
    );
    expect(onStatusChange).toHaveBeenLastCalledWith(
      SmartBotConnectionStatus.AUTH_FAILED,
    );
    const prepared = await prepareSmartBotSend(target, 'test');
    await expect(
      sendSmartBot(target, 'test', { preparedSend: prepared }),
    ).resolves.toMatchObject({ ok: false, retryable: true });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('binds a group from an exact one-time code without persisting message content', async () => {
    const client = await authenticatedClient();
    const bindingCode = `ERP-BIND-${'A'.repeat(32)}`;
    const tx = {
      notificationSmartBotBindingReceipt: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      $queryRaw: vi.fn(async () => [
        { now: new Date('2026-09-03T00:00:00.000Z') },
      ]),
      notificationChannel: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'channel-1' })
          .mockResolvedValueOnce(null),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    dbMock.$transaction.mockImplementationOnce(async (callback) =>
      callback(tx),
    );

    client.emit('message.text', {
      body: {
        msgid: 'message-1',
        aibotid: 'bot-id-placeholder',
        chatid: 'group-chat-1',
        chattype: 'group',
        msgtype: 'text',
        text: { content: `@ERP智能机器人 ${bindingCode}` },
      },
    });

    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledExactlyOnceWith(
        'group-chat-1',
        expect.objectContaining({ chat_type: 2 }),
      );
    });
    expect(
      tx.notificationSmartBotBindingReceipt.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          botDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          msgId: 'message-1',
        },
      ],
      skipDuplicates: true,
    });
    expect(tx.notificationChannel.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        smartBotBindingCodeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      select: { id: true },
    });
    expect(JSON.stringify(tx.notificationSmartBotBindingReceipt.createMany.mock.calls))
      .not.toContain(bindingCode);
  });

  it('ignores a random code-shaped message without storing a receipt or replying', async () => {
    const client = await authenticatedClient();
    const tx = {
      $queryRaw: vi.fn(async () => [
        { now: new Date('2026-09-03T00:00:00.000Z') },
      ]),
      notificationChannel: {
        findFirst: vi.fn(async () => null),
      },
      notificationSmartBotBindingReceipt: {
        createMany: vi.fn(),
      },
    };
    dbMock.$transaction.mockImplementationOnce(async (callback) =>
      callback(tx),
    );

    client.emit('message.text', {
      body: {
        msgid: 'message-random',
        aibotid: 'bot-id-placeholder',
        chatid: 'group-chat-1',
        chattype: 'group',
        msgtype: 'text',
        text: { content: `ERP-BIND-${'Z'.repeat(32)}` },
      },
    });

    await vi.waitFor(() => expect(tx.notificationChannel.findFirst).toHaveBeenCalled());
    expect(tx.notificationSmartBotBindingReceipt.createMany).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects ambiguous messages containing more than one binding code', async () => {
    const client = await authenticatedClient();
    const firstCode = `ERP-BIND-${'A'.repeat(32)}`;
    const secondCode = `ERP-BIND-${'B'.repeat(32)}`;

    client.emit('message.text', {
      body: {
        msgid: 'message-ambiguous',
        aibotid: 'bot-id-placeholder',
        chatid: 'group-chat-1',
        chattype: 'group',
        msgtype: 'text',
        text: {
          content: `@ERP智能机器人 ${firstCode} ${secondCode}`,
        },
      },
    });

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('filters ordinary text synchronously before it can occupy the binding queue', async () => {
    const client = await authenticatedClient();
    dbMock.$transaction.mockResolvedValue('INVALID');

    for (let index = 0; index < 100; index += 1) {
      client.emit('message.text', {
        body: {
          msgid: `ordinary-${index}`,
          aibotid: 'bot-id-placeholder',
          chatid: 'group-chat-1',
          chattype: 'group',
          msgtype: 'text',
          text: { content: 'ordinary conversation text' },
        },
      });
    }
    expect(dbMock.$transaction).not.toHaveBeenCalled();

    client.emit('message.text', bindingFrame('valid-after-ordinary'));
    await vi.waitFor(() => expect(dbMock.$transaction).toHaveBeenCalledOnce());
  });

  it('runs at most two binding tasks and queues through the ninth callback', async () => {
    const client = await authenticatedClient();
    let releaseTransactions!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransactions = resolve;
    });
    let activeTransactions = 0;
    let maxActiveTransactions = 0;
    dbMock.$transaction.mockImplementation(async () => {
      activeTransactions += 1;
      maxActiveTransactions = Math.max(
        maxActiveTransactions,
        activeTransactions,
      );
      await transactionGate;
      activeTransactions -= 1;
      return 'INVALID';
    });

    for (let index = 0; index < 9; index += 1) {
      client.emit('message.text', bindingFrame(`queued-${index}`));
    }

    await vi.waitFor(() =>
      expect(dbMock.$transaction).toHaveBeenCalledTimes(2),
    );
    expect(maxActiveTransactions).toBe(2);

    releaseTransactions();
    await vi.waitFor(() =>
      expect(dbMock.$transaction).toHaveBeenCalledTimes(9),
    );
    await vi.waitFor(() => expect(activeTransactions).toBe(0));
    expect(maxActiveTransactions).toBe(2);
  });

  it('bounds queued binding callbacks and emits one redaction-safe overflow warning', async () => {
    const warningSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const client = await authenticatedClient();
    let releaseTransactions!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransactions = resolve;
    });
    dbMock.$transaction.mockImplementation(async () => {
      await transactionGate;
      return 'INVALID';
    });

    for (let index = 0; index < 70; index += 1) {
      client.emit('message.text', bindingFrame(`bounded-${index}`));
    }

    await vi.waitFor(() =>
      expect(dbMock.$transaction).toHaveBeenCalledTimes(2),
    );
    expect(warningSpy).toHaveBeenCalledExactlyOnceWith(
      '[wecom-smart-bot] binding callback queue full',
    );
    expect(JSON.stringify(warningSpy.mock.calls)).not.toContain('bounded-');

    releaseTransactions();
    await vi.waitFor(() =>
      expect(dbMock.$transaction).toHaveBeenCalledTimes(66),
    );
  });

  it('isolates late client events and binding tasks across stop/start generations', async () => {
    let resolveOldTransaction!: (result: 'INVALID') => void;
    const oldTransaction = new Promise<'INVALID'>((resolve) => {
      resolveOldTransaction = resolve;
    });
    let resolveNewTransaction!: (result: 'INVALID') => void;
    const newTransaction = new Promise<'INVALID'>((resolve) => {
      resolveNewTransaction = resolve;
    });
    dbMock.$transaction
      .mockImplementationOnce(async () => oldTransaction)
      .mockImplementationOnce(async () => newTransaction);

    const oldClient = await authenticatedClient();
    oldClient.emit('message.text', bindingFrame('old-generation'));
    await vi.waitFor(() => expect(dbMock.$transaction).toHaveBeenCalledOnce());

    const oldStop = stopWecomSmartBotConnector();
    const newOnFatal = vi.fn();
    startWecomSmartBotConnector(credentials, { onFatal: newOnFatal });
    const newClient = sdkMock.instances[1];
    expect(newClient).toBeDefined();
    newClient.emit('authenticated');
    newClient.emit('message.text', bindingFrame('new-generation'));
    await vi.waitFor(() =>
      expect(dbMock.$transaction).toHaveBeenCalledTimes(2),
    );

    oldClient.emit('disconnected');
    oldClient.emit('event.disconnected_event', {});
    expect(getSmartBotRuntimeStatus()).toMatchObject({
      status: SmartBotConnectionStatus.CONNECTED,
      authenticated: true,
      fatalUnavailable: false,
    });
    expect(newOnFatal).not.toHaveBeenCalled();

    resolveOldTransaction('INVALID');
    await oldStop;

    let newStopSettled = false;
    const newStop = stopWecomSmartBotConnector().then(() => {
      newStopSettled = true;
    });
    await Promise.resolve();
    expect(newStopSettled).toBe(false);

    resolveNewTransaction('INVALID');
    await newStop;
    expect(newStopSettled).toBe(true);
  });

  it('replaces the SDK logger so credential-bearing arguments are never emitted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await authenticatedClient();
    const logger = sdkMock.instances[0].options.logger as {
      error(message: string, value: string): void;
    };
    logger.error('provider error', 'rotated-secret-placeholder');

    expect(errorSpy).toHaveBeenCalledWith('[wecom-smart-bot] sdk error');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      'rotated-secret-placeholder',
    );
  });
});
