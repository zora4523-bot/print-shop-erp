import { describe, expect, it } from 'vitest';
import {
  planOrderShipmentEdits,
  type EditableShipment,
} from '../edit-shipment-fields';
import { updateEditableOrderSchema } from '@/lib/auth/schemas';
const shipment: EditableShipment = {
  id: 's1',
  sequence: 1,
  status: 'PLANNED',
  receiverName: '张三',
  receiverPhone: '13800138000',
  receiverAddress: '浙江省杭州市原地址',
  expressCode: 'ZTO',
  destinationProvince: '浙江',
};
const input = (patch = {}) => ({
  id: 's1',
  receiverName: '张三',
  receiverPhone: '13800138000',
  receiverAddress: '浙江省杭州市原地址',
  expressCode: 'ZTO',
  expectedDestinationProvince: '浙江',
  sameDestination: false,
  ...patch,
});
describe('full order editor delivery invariants', () => {
  it('requires complete external delivery contacts, while retaining legacy internal semantics', () => {
    expect(() =>
      planOrderShipmentEdits(
        [shipment],
        [input({ receiverPhone: '' })],
        false,
        true,
      ),
    ).toThrow('收件人和收货电话');
    expect(
      planOrderShipmentEdits([shipment], [input({ receiverPhone: '' })], false),
    ).toHaveLength(1);
  });
  it('no-op saves do not rewrite shipments or require address acknowledgement', () =>
    expect(planOrderShipmentEdits([shipment], [input()], false)).toEqual([]));
  it('updates each shipment by its own identity, preserving primary and allocations', () => {
    const secondary = { ...shipment, id: 's2', sequence: 2 };
    const result = planOrderShipmentEdits(
      [shipment, secondary],
      [input(), input({ id: 's2', receiverPhone: '13900139000' })],
      false,
    );
    expect(result).toEqual([
      {
        id: 's2',
        sequence: 2,
        before: secondary,
        data: {
          receiverName: '张三',
          receiverPhone: '13900139000',
          receiverAddress: shipment.receiverAddress,
          expressCode: 'ZTO',
        },
      },
    ]);
  });
  it.each([
    { rows: [input({ id: 'foreign' })] },
    { rows: [] },
    { rows: [input(), input()] },
  ])(
    'rejects foreign, missing, and duplicated shipment identities',
    ({ rows }) =>
      expect(() => planOrderShipmentEdits([shipment], rows, false)).toThrow(
        /配送记录/,
      ),
  );
  it('requires rechecking existing province when address text changes', () => {
    expect(() =>
      planOrderShipmentEdits(
        [shipment],
        [input({ receiverAddress: '浙江省杭州市新地址' })],
        false,
      ),
    ).toThrow(/配送省份/);
    expect(
      planOrderShipmentEdits(
        [shipment],
        [
          input({
            receiverAddress: '浙江省杭州市新地址',
            sameDestination: true,
          }),
        ],
        false,
      ),
    ).toHaveLength(1);
  });
  it('never accepts a changed billing province or an unknown province as unchanged', () => {
    expect(() =>
      planOrderShipmentEdits(
        [shipment],
        [
          input({
            receiverAddress: '广东省新地址',
            expectedDestinationProvince: '广东',
            sameDestination: true,
          }),
        ],
        false,
      ),
    ).toThrow(/计费省份已变化/);
    expect(() =>
      planOrderShipmentEdits(
        [{ ...shipment, destinationProvince: null }],
        [
          input({
            receiverAddress: '新地址',
            expectedDestinationProvince: null,
            sameDestination: true,
          }),
        ],
        false,
      ),
    ).toThrow(/核对配送/);
  });
  it('retains SF collect semantics without inventing prepaid charges', () =>
    expect(
      planOrderShipmentEdits(
        [shipment],
        [input({ receiverAddress: '新地址' })],
        true,
      ),
    ).toHaveLength(1));
  it('refuses edits to shipped addresses', () =>
    expect(() =>
      planOrderShipmentEdits(
        [{ ...shipment, status: 'SHIPPED' }],
        [input({ receiverName: '李四' })],
        false,
      ),
    ).toThrow(/已发货/));
  it('validates duplicated identities and refuses unexpected financial fields at the boundary', () => {
    expect(
      updateEditableOrderSchema.safeParse({
        expectedEditVersion: '1',
        shipments: [input(), input()],
      }).success,
    ).toBe(false);
    expect(
      updateEditableOrderSchema.safeParse({
        expectedEditVersion: '1',
        shipments: [input({ shippingFee: '0' })],
      }).success,
    ).toBe(false);
  });
});
