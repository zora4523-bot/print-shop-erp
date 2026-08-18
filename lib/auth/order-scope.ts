import { OrderStatus, Role } from '../../generated/prisma/client';

// Pure helper — no session / auth dependencies — so it can be imported
// from anywhere (tests included) without dragging next-auth's server
// runtime into the compilation graph.
//
// Returns a Prisma `where` fragment to apply to Order queries so role
// visibility matches SPEC §2.2:
//   - ADMIN: see every order
//   - SALES / CUSTOMER_SERVICE: only their own submissions
//   - WORKER: only assigned orders that have left the SUBMITTED scheduling-draft state
//   - unknown role: an impossible filter (hard-fail rather than leak)
export function getOrderScopeFilter(user: { id: string; role: Role }) {
  if (user.role === Role.ADMIN) {
    return {};
  }
  if (user.role === Role.SALES || user.role === Role.CUSTOMER_SERVICE) {
    return { submitterId: user.id };
  }
  if (user.role === Role.WORKER) {
    return {
      // Partial batch scheduling may create assigned PENDING tasks while the
      // order is still SUBMITTED. Those rows are drafts until the final
      // internal craft is assigned, so no shared detail / print / PDF reader
      // may expose them to the worker yet (DECISIONS: scheduling draft boundary).
      status: { not: OrderStatus.SUBMITTED },
      items: {
        some: {
          tasks: {
            some: { workerId: user.id },
          },
        },
      },
    };
  }
  return { id: 'never-match' };
}
