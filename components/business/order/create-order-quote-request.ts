export type CreateOrderQuoteRequestGate = {
  sequence: number;
  latestRequestId: number;
};

export function createOrderQuoteRequestGate(): CreateOrderQuoteRequestGate {
  return { sequence: 0, latestRequestId: 0 };
}

export function beginOrderQuoteRequest(
  gate: CreateOrderQuoteRequestGate,
): number {
  const requestId = ++gate.sequence;
  gate.latestRequestId = requestId;
  return requestId;
}

export function invalidateOrderQuoteRequests(
  gate: CreateOrderQuoteRequestGate,
): void {
  gate.latestRequestId = ++gate.sequence;
}

export function isCurrentOrderQuoteResponse(args: {
  gate: CreateOrderQuoteRequestGate;
  requestId: number;
  inputKey: string;
  currentInputKey: string;
  fieldIds: readonly string[];
  currentFieldIds: readonly string[];
}): boolean {
  return (
    args.gate.latestRequestId === args.requestId &&
    args.inputKey === args.currentInputKey &&
    args.fieldIds.length === args.currentFieldIds.length &&
    args.fieldIds.every(
      (fieldId, index) => fieldId === args.currentFieldIds[index],
    )
  );
}
