export class OrderChangeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderChangeRequestError';
  }
}
