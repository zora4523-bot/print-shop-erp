import { Prisma } from '../../generated/prisma/client';
import type { PieceworkDraftInput } from './piecework-admin-input';
import { PieceworkPriceBookAdminError } from './piecework-price-book-admin';


export function foilFeeData(input: Pick<PieceworkDraftInput, 'partialSmall' | 'partialSetup' | 'fullSmall' | 'fullSetup'>, operationType: string) {
  const small = operationType === 'PARTIAL' ? input.partialSmall : operationType === 'FULL' ? input.fullSmall : undefined;
  const setup = operationType === 'PARTIAL' ? input.partialSetup : operationType === 'FULL' ? input.fullSetup : undefined;
  if (Boolean(small) !== Boolean(setup)) throw new PieceworkPriceBookAdminError('请同时填写小单工资和大单装版费');
  return { smallOrderAmount: small ? new Prisma.Decimal(small) : null, setupAmount: setup ? new Prisma.Decimal(setup) : null };
}
