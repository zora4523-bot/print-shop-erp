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
            paperWeightGsm: 160,
            paperType: '160g触感纸',
            productStructure: 'STANDARD_ENVELOPE',
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
        weightItems: [
          {
            itemKey: 'touch-paper',
            quantity: 2_000,
            paperWeightGsm: 160,
            paperType: '160g触感纸',
            productStructure: 'STANDARD_ENVELOPE',
          },
        ],
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
          paperWeightGsm: 160,
          productStructure: 'STANDARD_ENVELOPE',
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
    expect(result.map((shipment) => shipment.weightItems[0]?.quantity)).toEqual([
      50,
      100,
    ]);
  });

  it('does not require a weight for SF collect', () => {
    expect(
      deriveExternalOrderChargeShipments({
        isSfCollect: true,
        items: [
          {
            quantity: 500,
            paperWeightGsm: 160,
            productStructure: 'STANDARD_ENVELOPE',
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

  it.each([
    [null, null],
    ['', null],
    ['0', '0'],
    ['-1', '-1'],
    ['1.2345', '1.2345'],
    ['unknown', 'unknown'],
  ])('preserves a non-empty actual-weight fact for fail-closed validation: %j', (
    billableWeightKg,
    expected,
  ) => {
    expect(
      deriveExternalOrderChargeShipments({
        isSfCollect: false,
        items: [
          {
            quantity: 500,
            paperWeightGsm: 160,
            productStructure: 'STANDARD_ENVELOPE',
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
    ).toBe(expected);
  });

  it('keeps unknown structure and grams as explicit fail-closed facts', () => {
    const shipment = deriveExternalOrderChargeShipments({
      isSfCollect: false,
      items: [{ quantity: 500 }],
      shipments: [
        {
          shipmentKey: '1',
          province: '广东',
          billableWeightKg: null,
          itemQuantities: [500],
        },
      ],
    })[0];

    expect(shipment?.weightItems).toEqual([
      expect.objectContaining({
        quantity: 500,
        paperWeightGsm: null,
        productStructure: 'UNSPECIFIED',
      }),
    ]);
  });
});
