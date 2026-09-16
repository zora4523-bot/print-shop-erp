export type PieceworkActionResult = {
  status: 'success' | 'error';
  message: string;
  fieldErrors?: Record<string, string[]>;
};
