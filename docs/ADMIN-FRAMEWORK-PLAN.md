# Internal Admin Framework Plan

Date: 2026-06-29

## Goal

Reduce future ERP module development cost by extracting the repeated admin
patterns already visible in products, crafts, materials, users, and readiness
pages.

This is not a rewrite. It is a thin internal framework that preserves:

- Next.js App Router
- Server Components by default
- Server Actions for standard forms
- Prisma data access
- Zod validation
- centralized RBAC

## Problem

Adding a new admin module currently means hand-writing:

- `lib/entity.ts`
- `actions/entity.ts`
- `components/business/entity/Form.tsx`
- `components/business/entity/Table.tsx`
- list page
- new page
- edit page
- schemas
- permission entries
- navigation entries
- unit tests
- optional E2E checks

That is correct but repetitive. Without a shared framework layer, the project
will become slower to extend and harder to keep consistent.

## Foundation 1 - Unified CRUD Template

Target structure:

```text
lib/<entity>.ts
actions/<entity>.ts
actions/<entity>.types.ts
components/business/<entity>/<Entity>Form.tsx
components/business/<entity>/<Entity>Table.tsx
app/(admin)/owner/<entities>/page.tsx
app/(admin)/owner/<entities>/new/page.tsx
app/(admin)/owner/<entities>/[id]/page.tsx
```

Shared conventions:

- `list<Entity>`
- `get<Entity>Summary`
- `create<Entity>`
- `update<Entity>`
- `set<Entity>Active`
- `create<Entity>Action`
- `update<Entity>Action`
- `set<Entity>ActiveAction`

Acceptance:

- new dictionary-style modules can follow one checklist
- product/material/craft patterns become intentionally consistent
- no runtime code generation is required initially

### CRUD Action Contract

Standard dictionary-style modules should use the shared helpers in
`lib/admin/action-helpers.ts`.

Recommended server action flow:

1. `await requirePermission('<permission>')` as the first business operation.
2. Normalize `FormData` with `getFormString` / `getFormStringOr`.
3. Validate with the module Zod schema.
4. Return `invalidFromIssues(parsed.error.issues)` on validation failure.
5. Call the business lib function.
6. Map expected Prisma unique errors with `mapPrismaUniqueViolation`.
7. Map expected domain invariant errors with `mapInvariantError`.
8. Revalidate all affected paths with `revalidatePaths`.
9. Redirect on successful create; return `{ status: 'success' }` on successful
   update/toggle.

Mutation result types should alias the shared contract:

```ts
import type { MutationResult } from '@/lib/admin/action-helpers';

export type EntityMutationResult = MutationResult;
```

This keeps client components importing a tiny type-only file while all server
actions share the same shape.

## Foundation 2 - Unified Table Capability

Start with a server-rendered table helper, not a heavy SPA grid.

Common capabilities:

- search input
- empty state
- pagination
- sort links
- filter chips
- active/inactive status display
- row action slot
- bulk action slot, only when needed

Acceptance:

- list pages no longer hand-write search and empty state every time
- table parameters are URL-based for shareability
- large tables have pagination before they become slow

Initial implementation:

- `lib/admin/table.ts` provides URL/query helpers, defensive parsing, sort
  direction toggling, href building, and array pagination.
- `components/business/admin/AdminDataTable.tsx` provides server-rendered
  primitives for search toolbar, table card, sortable headers, pagination,
  status badge, and row actions.
- `/owner/materials` is the first proof page. It keeps the existing material
  search behavior, adds URL-driven sorting and pagination, and stays on Server
  Components / Server Actions.

## Foundation 3 - Unified Form And Action Result

Standard action result:

```ts
type MutationResult =
  | { status: 'success'; message?: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
```

Shared helpers:

- collect Zod field errors
- normalize FormData strings
- map Prisma unique errors
- standard revalidation helper
- standard success/error display blocks

Acceptance:

- product/material/craft forms can share error handling behavior
- tests assert first-line permission checks consistently
- Server Actions keep returning serializable results

## Foundation 4 - Menu, Permission, And Page Metadata Registry

Current menu and permissions are already centralized, but page metadata is still
spread across pages.

Add a registry that can declare:

- module id
- label
- route base
- icon
- required permission
- owner/foreman/sales/customer-service visibility
- breadcrumb label
- menu section
- whether the module is hidden, active, or experimental

Acceptance:

- sidebar, breadcrumbs, route titles, and tests read from the same metadata
- missing permission/menu wiring becomes testable
- placeholders and implemented pages are explicit

## Foundation 5 - Complex Client Data Layer

Do not convert the whole project to a SPA.

Use a client data layer only for complex screens:

- drag-and-drop production scheduling
- inventory count sheets
- batch material issue
- bulk order edit
- spreadsheet-like price editing

Preferred pattern:

- keep normal CRUD on Server Actions
- add route handlers under `/api/admin/*` only for highly interactive pages
- use a client component island for the complex surface
- keep server-side permission checks in route handlers
- keep Prisma writes in server-only modules

Candidate package:

- TanStack Query, only when the first complex page requires it

Acceptance:

- no global architecture rewrite
- no duplicated auth model
- complex pages have optimistic UI or polling only where it pays off

## Suggested Automation Backlog Order

1. CRUD/action result foundation
2. Data table foundation
3. module metadata registry
4. Soybean-inspired shell POC
5. customer/supplier master data
6. purchase orders and receipts
7. warehouse/location and stock ledger
8. BOM and material usage
9. audit log standardization
10. receivable/payable expansion after owner approval

## Testing Policy

Every framework task should include:

- unit tests for helpers
- at least one migrated module as proof
- E2E smoke if routing or shell UI changes
- `prisma validate`
- `tsc --noEmit --pretty false`
- `eslint .`
- `vitest run --reporter=dot --testTimeout=10000`
- `next build` when App Router pages or shared page components change
