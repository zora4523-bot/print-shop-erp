import { expect, it } from 'vitest';
import { cdrPackingDiagnostic } from '../diagnostics';
it.each(['AccessDenied', 'NoSuchKey', 'ENOSPC', 'ECONNRESET'])('retains safe packing cause %s', code => {
  expect(cdrPackingDiagnostic({ code, status: 403, message: 'secret signed URL' })).toEqual({ code: 'CdrZipError', cause: code, status: 403 });
});
it('recognizes SDK message prefixes without recording messages or credentials', () => {
  expect(cdrPackingDiagnostic(new Error('AccessDenied: https://bucket/file?Signature=secret'))).toEqual({ code: 'CdrZipError', cause: 'AccessDenied' });
  for (const error of [null, 'secret', { code: 'credential-secret', name: 'secret', message: 'https://bucket/file?Signature=secret', status: 200 }]) {
    expect(cdrPackingDiagnostic(error)).toEqual({ code: 'CdrZipError', cause: 'UnknownPackingError' });
  }
});
