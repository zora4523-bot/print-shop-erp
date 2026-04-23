import { Role } from '../../generated/prisma/client';

// Pure helper — no session / auth dependencies — so it can be imported
// from anywhere (tests included) without dragging next-auth's server
// runtime into the compilation graph.
//
// Returns a Prisma `where` fragment to apply to Order queries so role
// visibility matches SPEC §2.2:
//   - OWNER / FOREMAN: see every order
//   - SALES / CUSTOMER_SERVICE: only their own submissions
//   - WORKER: only orders whose items have a task assigned to them
//   - unknown role: an impossible filter (hard-fail rather than leak)
export function getOrderScopeFilter(user: { id: string; role: Role }) {
  if (user.role === Role.OWNER || user.role === Role.FOREMAN) {
    return {};
  }
  if (user.role === Role.SALES || user.role === Role.CUSTOMER_SERVICE) {
    return { submitterId: user.id };
  }
  if (user.role === Role.WORKER) {
    return {
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
