/** Existing customer ownership is established through the salesperson's orders. */
export function salesCustomerScope(salesId: string) {
  return { customerOrders: { some: { submitterId: salesId } } };
}
