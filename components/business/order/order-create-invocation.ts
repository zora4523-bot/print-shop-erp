import type {
  CreateOrderMutationResult,
  SubmitOrderMutationResult,
} from '@/actions/order.types';

export const ORDER_CREATE_RETRY_MESSAGE =
  '创建失败，填写内容已保留，请重试。';
export const ORDER_SUBMIT_RETRY_MESSAGE = '服务暂时不可用，请重试。';

export async function runCreateOrderAction(
  invoke: () => Promise<CreateOrderMutationResult>,
): Promise<CreateOrderMutationResult> {
  try {
    return await invoke();
  } catch {
    return {
      status: 'error',
      message: ORDER_CREATE_RETRY_MESSAGE,
    };
  }
}

export async function runSubmitOrderAction(
  invoke: () => Promise<SubmitOrderMutationResult>,
): Promise<SubmitOrderMutationResult> {
  try {
    return await invoke();
  } catch {
    return {
      status: 'error',
      message: ORDER_SUBMIT_RETRY_MESSAGE,
    };
  }
}
