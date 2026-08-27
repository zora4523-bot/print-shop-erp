import { describe, expect, it, vi } from 'vitest';
import {
  ORDER_CREATE_RETRY_MESSAGE,
  ORDER_SUBMIT_RETRY_MESSAGE,
  runCreateOrderAction,
  runSubmitOrderAction,
} from '../order-create-invocation';

describe('runCreateOrderAction', () => {
  it('keeps the structured result returned by the server action', async () => {
    const result = await runCreateOrderAction(async () => ({
      status: 'success',
      orderId: 'order-1',
      orderNo: 'GD-260827-001',
      itemIds: ['item-1'],
    }));

    expect(result).toEqual({
      status: 'success',
      orderId: 'order-1',
      orderNo: 'GD-260827-001',
      itemIds: ['item-1'],
    });
  });

  it('maps a rejected invocation to an inline retry result', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('transport failure'));

    await expect(runCreateOrderAction(invoke)).resolves.toEqual({
      status: 'error',
      message: ORDER_CREATE_RETRY_MESSAGE,
    });
    expect(invoke).toHaveBeenCalledOnce();
  });
});

describe('runSubmitOrderAction', () => {
  it('keeps the structured result returned by the server action', async () => {
    await expect(
      runSubmitOrderAction(async () => ({ status: 'success' })),
    ).resolves.toEqual({ status: 'success' });
  });

  it('maps a rejected invocation to a recoverable inline error', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('transport failure'));

    await expect(runSubmitOrderAction(invoke)).resolves.toEqual({
      status: 'error',
      message: ORDER_SUBMIT_RETRY_MESSAGE,
    });
    expect(invoke).toHaveBeenCalledOnce();
  });
});
