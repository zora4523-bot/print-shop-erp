import { OrderStatus, Role } from '../../generated/prisma/enums';

// Pure helper — no session / auth dependencies — so it can be imported
// from anywhere (tests included) without dragging next-auth's server
// runtime into the compilation graph.
//
// Returns a Prisma `where` fragment to apply to Order queries so role
// visibility matches SPEC §2.2:
//   - ADMIN: see every order
//   - SALES: only their own submissions
//   - WORKER: historical ProductionTask ownership only; new operation views use
//     the fixed-lane worker portal instead of this legacy scope
//   - unknown role: an impossible filter (hard-fail rather than leak)
export function getOrderScopeFilter(user: { id: string; role: Role }) {
  if (user.role === Role.ADMIN) {
    return {};
  }
  if (user.role === Role.SALES) {
    return { submitterId: user.id };
  }
  if (user.role === Role.WORKER) {
    return {
      // Read-only compatibility for old detail / print / PDF links. New orders
      // are authorized by ProductionOperation lane in lib/worker-portal.ts.
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
