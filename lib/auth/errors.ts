export class UnauthorizedError extends Error {
  constructor(message: string = '未授权') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
