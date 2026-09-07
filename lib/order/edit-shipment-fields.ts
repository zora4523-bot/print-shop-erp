import type { UpdateEditableOrderInput } from '@/lib/auth/schemas';

export type EditableShipment = {
  id: string;
  sequence: number;
  status: string;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  expressCode: string | null;
  destinationProvince: string | null;
};
export class OrderShipmentEditError extends Error {}

export function planOrderShipmentEdits(
  current: readonly EditableShipment[],
  input: NonNullable<UpdateEditableOrderInput['shipments']>,
  isSfCollect: boolean,
  requiresContact = false,
) {
  if (
    current.length !== input.length ||
    new Set(input.map((row) => row.id)).size !== input.length ||
    input.some((row) => !current.some((stored) => stored.id === row.id))
  ) {
    throw new OrderShipmentEditError(
      '配送记录已变化或包含其他工单的地址，请刷新页面后重试',
    );
  }
  return input.flatMap((row) => {
    const stored = current.find((shipment) => shipment.id === row.id)!;
    const data = {
      receiverName: row.receiverName?.trim() || null,
      receiverPhone: row.receiverPhone?.trim() || null,
      receiverAddress: row.receiverAddress.trim(),
      expressCode: row.expressCode?.trim() || null,
    };
    if (requiresContact && (!data.receiverName || !data.receiverPhone))
      throw new OrderShipmentEditError(
        `第 ${stored.sequence} 票请填写收件人和收货电话`,
      );
    if (!data.receiverAddress)
      throw new OrderShipmentEditError(
        `第 ${stored.sequence} 票收货地址不能为空`,
      );
    const changed = Object.entries(data).some(
      ([key, value]) => stored[key as keyof typeof data] !== value,
    );
    if (!changed) return [];
    if (stored.status === 'SHIPPED')
      throw new OrderShipmentEditError(
        `第 ${stored.sequence} 票已发货，不能修改收货信息`,
      );
    if (stored.destinationProvince !== row.expectedDestinationProvince)
      throw new OrderShipmentEditError(
        '配送计费省份已变化，请刷新后重新核对地址',
      );
    if (
      data.receiverAddress !== stored.receiverAddress &&
      !isSfCollect &&
      (!stored.destinationProvince || !row.sameDestination)
    ) {
      throw new OrderShipmentEditError(
        `第 ${stored.sequence} 票地址已修改，请先核对配送省份和物流费用；同省地址可勾选省份未变后保存`,
      );
    }
    return [{ id: stored.id, sequence: stored.sequence, before: stored, data }];
  });
}
