import 'server-only';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';

import { salesCustomerScope } from './sales-customer-policy';

export async function listSalesCustomerOptions(actor: { id: string; role: Role }) {
  if (actor.role !== Role.SALES) throw new Error('仅销售可查询自己的客户');
  return db.party.findMany({
    where: { ...salesCustomerScope(actor.id), isActive: true, type: { in: ['CUSTOMER', 'BOTH'] } },
    select: { id: true, code: true, name: true, shortName: true },
    orderBy: [{ code: 'asc' }, { name: 'asc' }],
  });
}
