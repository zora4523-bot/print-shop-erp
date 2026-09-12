type ExtraShipmentContact = { sequence?: number; receiverName?: string | null; receiverPhone?: string | null };

/** External-sales delivery contacts are required for every destination. */
export function externalShipmentContactIssues(shipments: readonly ExtraShipmentContact[]) {
  return shipments.flatMap((shipment, index) =>
    (['receiverName', 'receiverPhone'] as const).flatMap((field) =>
      shipment[field]?.trim() ? [] : [{
        path: ['additionalShipments', index, field] as const,
        message: `地址 ${(shipment.sequence ?? index + 2)}：请填写${field === 'receiverName' ? '收件人' : '联系电话'}`,
      }],
    ),
  );
}
