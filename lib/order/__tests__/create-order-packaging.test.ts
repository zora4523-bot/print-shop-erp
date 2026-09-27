import { describe, expect, it } from "vitest";
import {
  createOrderSchema,
  quoteCreateOrderPackagingGroupsSchema,
} from "@/lib/auth/schemas";
import { calculateCreateOrderBagCount } from "../create-order-packaging";
import { calculatePackagingBagCount } from "../packaging-bag-count";

function group(units: number[]) {
  return {
    name: null,
    groupKey: "1",
    mode:
      units.length > 1 ? ("MIXED_STYLE" as const) : ("SINGLE_STYLE" as const),
    actualBagCount: 100,
    itemUnitsPerBag: units,
  };
}

function command(units: number[]) {
  return {
    customerRef: null,
    receiverName: null,
    receiverPhone: null,
    receiverAddress: "测试地址",
    expressCode: null,
    packageRequirement: null,
    remark: null,
    packagingGroups: [group(units)],
    items: units.map((pack, index) => ({
      name: `测试 ${index + 1}`,
      pricingRoute: "STOCK_BLANK",
      quantity: pack * 100,
      pack,
      crafts: ["foil"],
      productId: "product",
      specification: "大号封",
      paperType: "160g珠光艳闪",
      hasLocalFoil: true,
      foilTechnique: "FLAT",
      frontFoilColors: ["亚金"],
      foilColors: ["亚金"],
      unitPrice: null,
      suggestedSubtotal: null,
      remark: null,
    })),
  };
}

describe("new order bag capacity", () => {
  it.each([[1], [12], [6, 6], [4, 8]])(
    "accepts a valid composition %j",
    (...units) => {
      const input = group(units);
      expect(
        calculateCreateOrderBagCount({
          ...input,
          itemQuantities: units.map((n) => n * 100),
        }),
      ).toMatchObject({ complete: true, bagCount: 100 });
      expect(
        quoteCreateOrderPackagingGroupsSchema.safeParse({ groups: [input] })
          .success,
      ).toBe(true);
      const parsed = createOrderSchema.safeParse(command(units));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    },
  );
  it.each([[13], [6, 7], [10, 10]])(
    "blocks oversized bags in create and quote: %j",
    (...units) => {
      const input = group(units);
      const quantities = units.map((n) => n * 100);
      expect(
        calculateCreateOrderBagCount({ ...input, itemQuantities: quantities }),
      ).toMatchObject({
        complete: false,
        errors: [expect.stringContaining("12")],
      });
      expect(
        quoteCreateOrderPackagingGroupsSchema.safeParse({ groups: [input] })
          .success,
      ).toBe(false);
      expect(createOrderSchema.safeParse(command(units)).success).toBe(false);
    },
  );
  it("validates the item pack even when no group is supplied", () => {
    const input = { ...command([13]), packagingGroups: [] };
    const result = createOrderSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["items", 0, "pack"] }),
      );
  });
  it("rejects fractional composition and keeps historical calculations available", () => {
    expect(
      calculateCreateOrderBagCount({ ...group([1.5]), itemQuantities: [100] })
        .complete,
    ).toBe(false);
    expect(
      calculatePackagingBagCount({ ...group([20]), itemQuantities: [1000] }),
    ).toMatchObject({ complete: true, bagCount: 50 });
  });
});
