import { z } from 'zod';
import {
  canonicalizeCreateOrderPaperFact,
  canonicalizeCreateOrderSpecification,
} from './create-order/canonical-facts';
import { parseCatalogPaperWeight } from '../order/catalog-pricing-facts';

export const BLANK_SPECIFICATIONS = [
  { key: 'mini', label: '迷你封', specification: '迷你封50×80' },
  { key: 'square', label: '方形封', specification: '方形88×88' },
  { key: 'mid', label: '中号封', specification: '中号封80×115' },
  { key: 'large', label: '大号封', specification: '大号封90×165' },
  { key: 'west-mid', label: '西封中号', specification: '西封中号80×120' },
  { key: 'west-large', label: '西封大号', specification: '西封大号85×165' },
] as const;

export function blankSpecificationKey(
  label: string | null | undefined,
): string | null {
  const canonical = label ? canonicalizeCreateOrderSpecification(label) : null;
  return (
    BLANK_SPECIFICATIONS.find((spec) => spec.label === canonical)?.key ?? null
  );
}

export function blankPaperFact(paper: {
  name: string;
  specification: string | null;
}) {
  return canonicalizeCreateOrderPaperFact(
    paper.name,
    parseCatalogPaperWeight(paper.specification) ??
      parseCatalogPaperWeight(paper.name),
  );
}

const safeId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, '请选择有效记录');
const paperName = z
  .string()
  .trim()
  .min(1, '请填写纸张名称')
  .max(60, '纸张名称最多 60 字')
  .refine(
    (value) => !/[\u0000-\u001f/／|]/u.test(value),
    '纸张名称不能包含控制字符或多个纸张',
  );
export const addBlankPaperSchema = z
  .object({
    priceBookId: safeId,
    expectedUpdatedAt: z.iso.datetime(),
    paper: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('existing'), id: safeId }).strict(),
      z
        .object({
          mode: z.literal('new'),
          name: paperName,
          weight: z
            .number()
            .int()
            .min(1, '克重至少为 1')
            .max(2000, '克重不能超过 2000'),
        })
        .strict()
        .refine(
          (paper) =>
            canonicalizeCreateOrderPaperFact(paper.name, paper.weight) !== null,
          { message: '纸张名称与克重不一致', path: ['weight'] },
        ),
    ]),
    specifications: z
      .array(
        z
          .object({
            key: z.enum([
              'mini',
              'square',
              'mid',
              'large',
              'west-mid',
              'west-large',
            ]),
            amount: z
              .string()
              .trim()
              .regex(
                /^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/,
                '单价须为非负数字，最多四位小数',
              )
              .nullable(),
          })
          .strict(),
      )
      .min(1, '请选择至少一种规格')
      .max(6)
      .refine(
        (rows) => new Set(rows.map((row) => row.key)).size === rows.length,
        '规格不能重复',
      ),
  })
  .strict();
export type AddBlankPaperInput = z.infer<typeof addBlankPaperSchema>;
export type AddBlankPaperResult =
  | { status: 'success'; paperId: string; priceBookId: string }
  | { status: 'error'; message: string };

export const blankPriceMatrixSchema = z.object({
  priceBookId: safeId,
  expectedUpdatedAt: z.iso.datetime(),
  cells: z.array(z.object({
    paperId: safeId,
    specificationKey: z.enum(BLANK_SPECIFICATIONS.map((spec) => spec.key)),
    amount: z.string().trim().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/, '单价须为非负数字，最多四位小数').nullable(),
  }).strict()).max(1200),
}).strict();
export type BlankPriceMatrixInput = z.infer<typeof blankPriceMatrixSchema>;
