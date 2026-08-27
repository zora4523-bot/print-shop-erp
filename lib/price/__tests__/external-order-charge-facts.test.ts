import { describe, expect, it } from 'vitest';
import { deriveExternalOrderChargeShipments } from '../external-order-charge-facts';

describe('deriveExternalOrderChargeShipments', () => {
  it('preserves a carrier-confirmed weight instead of deriving it from items', () => {
    expect(
      deriveExternalOrderChargeShipments({
        isSfCollect: false,
        items: [
          {
            itemKey: 'touch-paper',
            quantity: 2_000,
          },
        ],
        shipments: [
          {
            shipmentKey: '1',
            province: '广东',
            billableWeightKg: '12.5',
            itemQuantities: [2_000],
          },
        ],
      }),
    ).toEqual([
      {
        shipmentKey: '1',
        province: '广东',
        billableWeightKg: '12.5',
        itemQuantity: 2_000,
      },
    ]);
  });

  it('keeps each shipment weight and derives only allocated item quantity', () => {
    const result = deriveExternalOrderChargeShipments({
      isSfCollect: false,
      items: [
        {
          quantity: 150,
        },
      ],
      shipments: [
        {
          shipmentKey: '1',
          province: '广东',
          billableWeightKg: '1.5',
          itemQuantities: [50],
        },
        {
          shipmentKey: '2',
          province: '江西',
          billableWeightKg: '2',
          itemQuantities: [100],
        },
      ],
    });

    expect(result.map((shipment) => shipment.billableWeightKg)).toEqual([
      '1.5',
      '2',
    ]);
    expect(result.map((shipment) => shipment.itemQuantity)).toEqual([50, 100]);
  });

  it('does not require a weight for SF collect', () => {
    expect(
      deriveExternalOrderChargeShipments({
        isSfCollect: true,
        items: [
          {
            quantity: 500,
          },
        ],
        shipments: [
          {
            shipmentKey: '1',
            province: null,
            billableWeightKg: '8',
            itemQuantities: [500],
          },
        ],
      })[0]?.billableWeightKg,
    ).toBeNull();
  });

  it.each([null, '', '0', '-1', '1.2345', 'unknown'])(
    'fails closed to a null weight for untrusted input %j',
    (billableWeightKg) => {
      expect(
        deriveExternalOrderChargeShipments({
          isSfCollect: false,
          items: [
            {
              quantity: 500,
            },
          ],
          shipments: [
            {
              shipmentKey: '1',
              province: '广东',
              billableWeightKg,
              itemQuantities: [500],
            },
          ],
        })[0]?.billableWeightKg,
      ).toBeNull();
    },
  );
});
