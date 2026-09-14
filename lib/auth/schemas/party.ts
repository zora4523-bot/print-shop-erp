// 往来单位主数据：客户 / 供应商
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { PartyType } from '../../../generated/prisma/enums';
import { productTextFieldOptional } from './shared';

const partyCodeField = z
  .string()
  .trim()
  .min(1, '请填写客户/供应商编码')
  .max(32, '编码过长（最多 32 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '编码只能包含英文字母、数字、下划线、短横线');

const optionalPartyCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), partyCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const partyNameField = z
  .string()
  .trim()
  .min(1, '请填写客户/供应商名称')
  .max(128, '名称过长（最多 128 个字符）');

const partySchemaFields = {
  type: z.nativeEnum(PartyType),
  name: partyNameField,
  shortName: productTextFieldOptional('简称', 64),
  primaryContactName: productTextFieldOptional('默认联系人', 64),
  primaryContactPhone: productTextFieldOptional('默认联系电话', 32),
  primaryContactWechat: productTextFieldOptional('默认微信', 64),
  defaultReceiverName: productTextFieldOptional('默认收货人', 64),
  defaultReceiverPhone: productTextFieldOptional('默认收货电话', 32),
  defaultProvince: productTextFieldOptional('省份', 32),
  defaultCity: productTextFieldOptional('城市', 32),
  defaultDistrict: productTextFieldOptional('区县', 32),
  defaultAddressDetail: productTextFieldOptional('详细地址', 256),
} as const;

export const createPartySchema = z.object({
  ...partySchemaFields,
  code: optionalPartyCodeField,
});

export type CreatePartyInput = z.infer<typeof createPartySchema>;

export const updatePartySchema = z.object({
  ...partySchemaFields,
  code: partyCodeField,
});

export type UpdatePartyInput = z.infer<typeof updatePartySchema>;
