import { describe, expect, it } from 'vitest';
import {
  buildCustomerRuleCondition,
  EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
  parseCustomerRuleCondition,
} from '../customer-rule-condition';

describe('customer rule condition contract', () => {
  it('normalizes a legacy versionless structured condition and trims duplicate labels', () => {
    const parsed = parseCustomerRuleCondition({
      productCodes: [' EXT-COLOR-LARGE ', 'EXT-COLOR-LARGE'],
      craftCodes: [' COATED_COLOR_PRINT ', 'COATED_COLOR_PRINT'],
      pricingRoutes: ['COLOR_PRINT'],
      productStructures: ['STANDARD_ENVELOPE'],
      foilTechniques: ['NONE'],
      laminations: ['MATTE'],
      printColors: [' C ', 'C', 'M', 'Y', 'K'],
      printColorCount: 4,
      minWidthMm: 110,
      maxWidthMm: 110,
      minHeightMm: 230,
      maxHeightMm: 230,
      minPaperWeightGsm: 200,
      maxPaperWeightGsm: 200,
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.condition).toMatchObject({
      schemaVersion: 1,
      target: 'ITEM',
      productCodes: ['EXT-COLOR-LARGE'],
      craftCodes: ['COATED_COLOR_PRINT'],
      pricingRoutes: ['COLOR_PRINT'],
      productStructures: ['STANDARD_ENVELOPE'],
      foilTechniques: ['NONE'],
      laminations: ['MATTE'],
      printColors: ['C', 'M', 'Y', 'K'],
      printColorCount: 4,
      minWidthMm: 110,
      maxWidthMm: 110,
      minHeightMm: 230,
      maxHeightMm: 230,
      minPaperWeightGsm: 200,
      maxPaperWeightGsm: 200,
    });
  });

  it.each([
    {
      label: '未知字段',
      condition: { pricingRoute: 'COLOR_PRINT' },
      expectedMessage: '适用条件：设置无效，请重新选择或填写',
    },
    {
      label: '未支持的 schema 版本',
      condition: { schemaVersion: 2 },
      expectedMessage: '规则版本：设置无效，请重新选择或填写',
    },
    {
      label: '非法计价路线',
      condition: { pricingRoutes: ['COLOR_PRINT_WITH_FOIL'] },
      expectedMessage: '适用计价路线：设置无效，请重新选择或填写',
    },
    {
      label: '非法烫金工艺',
      condition: { foilTechniques: ['HOT_STAMP'] },
      expectedMessage: '烫金方式：设置无效，请重新选择或填写',
    },
  ])('对$label失败关闭', ({ condition, expectedMessage }) => {
    const parsed = parseCustomerRuleCondition(condition);

    expect(parsed.condition).toBeNull();
    expect(parsed.errors).toContain(expectedMessage);
    expect(parsed.errors.join('\n')).not.toMatch(
      /pricingRoute|schemaVersion|foilTechniques|Invalid option|COLOR_PRINT_WITH_FOIL|HOT_STAMP/,
    );
  });

  it.each([
    {
      label: '彩印颜色数',
      condition: { minPrintColorCount: 4, maxPrintColorCount: 3 },
      expectedPath: '彩印颜色最大数',
      expectedMessage: '彩印颜色数上限不能小于下限',
    },
    {
      label: '宽度',
      condition: { minWidthMm: 110, maxWidthMm: 109.9 },
      expectedPath: '最大宽度',
      expectedMessage: '宽度上限不能小于下限',
    },
    {
      label: '纸张克重',
      condition: { minPaperWeightGsm: 200, maxPaperWeightGsm: 160 },
      expectedPath: '最大纸张克重',
      expectedMessage: '纸张克重上限不能小于下限',
    },
    {
      label: '款式数',
      condition: { minItemCount: 2, maxItemCount: 1 },
      expectedPath: '订单最多款式数',
      expectedMessage: '款式数上限不能小于下限',
    },
  ])('拒绝$label上限小于下限', ({
    condition,
    expectedPath,
    expectedMessage,
  }) => {
    const parsed = parseCustomerRuleCondition(condition);

    expect(parsed.condition).toBeNull();
    expect(parsed.errors).toContain(`${expectedPath}：${expectedMessage}`);
  });

  it('只从 typed editor 构建已知字段，并显式写入 schema 版本', () => {
    const condition = buildCustomerRuleCondition(
      {
        ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
        pricingRoutes: ['COLOR_PRINT'],
        productStructures: ['STANDARD_ENVELOPE'],
        foilTechniques: ['NONE'],
        craftCodes: ['COATED_COLOR_PRINT'],
        printColors: ['C', 'M', 'Y', 'K'],
        printColorCount: 4,
        minWidthMm: 110,
        maxWidthMm: 110,
        perPrintColor: true,
      },
      { productCodes: ['EXT-COLOR-LARGE'], unitsPerSheet: null },
    );

    expect(condition).toEqual({
      schemaVersion: 1,
      target: 'ITEM',
      productCodes: ['EXT-COLOR-LARGE'],
      pricingRoutes: ['COLOR_PRINT'],
      productStructures: ['STANDARD_ENVELOPE'],
      foilTechniques: ['NONE'],
      craftCodes: ['COATED_COLOR_PRINT'],
      printColors: ['C', 'M', 'Y', 'K'],
      printColorCount: 4,
      minWidthMm: 110,
      maxWidthMm: 110,
      perPrintColor: true,
    });
  });

  it('往返保留烫金道数条件和乘算开关', () => {
    const condition = buildCustomerRuleCondition(
      {
        ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
        pricingRoutes: ['STOCK_BLANK'],
        foilPassCount: 3,
        perFoilPass: true,
      },
      { productCodes: ['EXT-STOCK-FOIL-A13'], unitsPerSheet: null },
    );

    expect(condition).toMatchObject({
      schemaVersion: 1,
      target: 'ITEM',
      productCodes: ['EXT-STOCK-FOIL-A13'],
      pricingRoutes: ['STOCK_BLANK'],
      foilPassCount: 3,
      perFoilPass: true,
    });
    expect(parseCustomerRuleCondition(condition)).toEqual({
      condition,
      errors: [],
    });
  });

  it('拒绝同时配置烫金道数精确值和范围', () => {
    const parsed = parseCustomerRuleCondition({
      pricingRoutes: ['STOCK_BLANK'],
      foilPassCount: 3,
      minFoilPassCount: 2,
      maxFoilPassCount: 4,
    });

    expect(parsed.condition).toBeNull();
    expect(parsed.errors).toContain(
      '烫金精确道数：烫金道数精确值和范围只能选择一种',
    );
    expect(parsed.errors.join('\n')).not.toMatch(/foilPassCount|minFoilPassCount/);
  });

  it('只允许包装组规则保存包装模式', () => {
    const condition = buildCustomerRuleCondition(
      {
        ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
        target: 'PACKAGING_GROUP',
        packagingModes: ['SINGLE_STYLE'],
      },
      { productCodes: [], unitsPerSheet: null },
    );

    expect(condition).toEqual({
      schemaVersion: 1,
      target: 'PACKAGING_GROUP',
      packagingModes: ['SINGLE_STYLE'],
    });
  });

  it('拒绝包装组与款式匹配条件混用', () => {
    const parsed = parseCustomerRuleCondition({
      schemaVersion: 1,
      target: 'PACKAGING_GROUP',
      packagingModes: ['MIXED_STYLE'],
      pricingRoutes: ['COLOR_PRINT'],
    });

    expect(parsed.condition).toBeNull();
    expect(parsed.errors).toContain(
      '适用计价路线：包装组规则不能混用款式匹配条件',
    );
  });
});
