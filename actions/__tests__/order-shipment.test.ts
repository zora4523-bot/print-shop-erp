import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  add: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/order/add-shipment', () => ({
  addOrderShipment: mocks.add,
  AddOrderShipmentError: class extends Error {},
}));
vi.mock('@/lib/price/order-charge-service', () => ({
  OrderCustomerChargeError: class extends Error {},
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { addOrderShipmentAction } from '../order-shipment';
const payload = {
  orderId: 'order',
  sourceShipmentId: 'source',
  expectedRevision: 1,
  expectedEditVersion: 1,
  expectedWorkOrderVersion: 1,
  expectedPriceRevision: 1,
  receiverName: '李女士',
  receiverPhone: '13800138000',
  receiverAddress: '江西省南昌市',
  destinationProvince: '江西',
  lines: [{ orderItemId: 'item', quantity: 1 }],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
});
it('checks authorization before parsing or accessing an order', async () => {
  mocks.permission.mockRejectedValue(new Error('无权访问'));
  await expect(addOrderShipmentAction({}, 'save')).rejects.toThrow('无权访问');
  expect(mocks.permission).toHaveBeenCalledWith('order:create');
  expect(mocks.add).not.toHaveBeenCalled();
});
it('rejects invalid allocation input without writes', async () => {
  expect(
    await addOrderShipmentAction({ ...payload, lines: [] }, 'save'),
  ).toMatchObject({ status: 'error' });
  expect(mocks.add).not.toHaveBeenCalled();
});
it('invalidates detail, editor and list only after saving', async () => {
  mocks.add.mockResolvedValueOnce({ token: 'preview' });
  expect(await addOrderShipmentAction(payload, 'preview')).toMatchObject({
    status: 'preview',
  });
  expect(mocks.revalidate).not.toHaveBeenCalled();
  mocks.add.mockResolvedValueOnce(null);
  expect(await addOrderShipmentAction(payload, 'save')).toEqual({
    status: 'saved',
  });
  expect(mocks.revalidate.mock.calls).toEqual([
    ['/orders'],
    ['/orders/order'],
    ['/orders/order/edit'],
  ]);
});
