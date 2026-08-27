import { describe, expect, it } from 'vitest';
import { deriveExternalOrderChargeShipments } from '../external-order-charge-facts';

describe('deriveExternalOrderChargeShipments', () => {
  it('derives one rounded shipment weight from item quantities', () => {
    expect(
      deriveExternalOrderChargeShipments({
        isSfCollect: false,
        items: [
          {
            itemKey: 'touch-paper',
            quantity: 2_000,
            paperWeightGsm: 200,
            productStructure: 'STANDARD_ENVELOPE',
          },
        ],
        shipments: [
          {
            shipmentKey: '1',
            province: '广东',
            itemQuantities: [2_000],
          },
        ],
      }),
    ).toEqual([
      {
        shipmentKey: '1',
        province: '广东',
        billableWeightKg: '16',
        itemQuantity: 2_000,
      },
    ]);
  });

  it('uses the ten-thousand-envelope unit weight and splits addresses', () => {
    const result = deriveExternalOrderChargeShipments({
      isSfCollect: false,
      items: [
        {
          quantity: 150,
          paperWeightGsm: null,
          productStructure: 'TEN_THOUSAND_ENVELOPE',
        },
      ],
      shipments: [
        { shipmentKey: '1', province: '广东', itemQuantities: [50] },
        { shipmentKey: '2', province: '江西', itemQuantities: [100] },
      ],
    });

    expect(result.map((shipment) => shipment.billableWeightKg)).toEqual([
      '1',
      '1',
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
            paperWeightGsm: null,
            productStructure: 'UNSPECIFIED',
          },
        ],
        shipments: [
          { shipmentKey: '1', province: null, itemQuantities: [500] },
        ],
      })[0]?.billableWeightKg,
    ).toBeNull();
  });

  it('fails closed to a null weight when the paper has no unit-weight rule', () => {
    expect(
      deriveExternalOrderChargeShipments({
        isSfCollect: false,
        items: [
          {
            quantity: 500,
            paperWeightGsm: 250,
            productStructure: 'STANDARD_ENVELOPE',
          },
        ],
        shipments: [
          { shipmentKey: '1', province: '广东', itemQuantities: [500] },
        ],
      })[0]?.billableWeightKg,
    ).toBeNull();
  });
});
