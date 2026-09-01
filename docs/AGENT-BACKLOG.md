# Agent Backlog

This file is the automation queue for Codex routines. A routine should pick the
first task whose status is `agent-ready`, create a branch, implement only that
task, run the listed verification commands, and open a draft PR.

Never auto-merge. Never apply production database operations from this backlog.

## Status Values

- `agent-ready`: safe for an agent to implement without more business input.
- `needs-owner-input`: needs the owner to confirm business rules, credentials, or
  UI behavior before development.
- `manual-ops-only`: may generate docs or readiness checks, but must not execute
  the operation automatically.
- `done`: implemented and verified.

## Selection Rules

1. Pick the highest-priority `agent-ready` item. For ties, keep file order.
2. Skip tasks that touch payroll/finance facts unless the task explicitly limits
   itself to tests, docs, or read-only UI.
3. For every code task, run:
   - `./node_modules/.bin/prisma validate`
   - `pnpm typecheck`
   - `./node_modules/.bin/eslint .`
   - `./node_modules/.bin/vitest run --reporter=dot --testTimeout=10000`
4. Run `./node_modules/.bin/next build` when touching App Router pages,
   components used by pages, Prisma schema, or migrations.
5. The PR must be draft unless the user explicitly asks for a ready PR.

## A01 - E2E Smoke Suite For Critical Flow

- Status: `done`
- Priority: P0
- Risk: medium
- Suggested branch: `codex/e2e-smoke-critical-flow`
- Scope:
  - Add Playwright tests for login, owner dashboard, order list, product search,
    Pigsty readiness page, and material inventory search.
  - Reuse existing seed data or create isolated `CODX-` prefixed fixtures in test
    setup.
  - Do not depend on real OSS, real WeCom webhook, or production Pigsty
    extensions.
- Acceptance:
  - `test:e2e` has a smoke file that can run against local dev.
  - Tests assert protected routes redirect when unauthenticated.
  - Tests assert `admin / admin@2026` can reach owner pages after seed.
  - Tests assert `pg_pinyin` missing is displayed as a blocker in non-Pigsty dev.
- Delivered:
  - Added `tests/e2e/smoke.spec.ts`.
  - Added reusable smoke fixtures in `tests/e2e/_helpers.ts`.
  - Added `E2E_BASE_URL` support in `playwright.config.ts`.
  - Added an `e2e-owner` ADMIN fixture in global setup.

## A02 - Material CRUD And Stock Transaction Flow

- Status: `done`
- Priority: P0
- Risk: medium-high
- Suggested branch: `codex/material-crud-stock-transactions`
- Scope:
  - Add owner/foreman material create/edit screens.
  - Add stock in/out forms that update `Material.currentStock` and insert
    `MaterialTransaction` in the same transaction.
  - Keep `/foreman/materials` as the read-only dashboard entry.
  - Add permission checks for material writes.
- Acceptance:
  - Stock in increases current stock and writes transaction.
  - Stock out decreases current stock and refuses negative inventory unless an
    explicit owner override is designed in the same PR.
  - Material search still works by code, name, specification, unit, pinyin fields.
- Delivered:
  - Added owner material dictionary list/create/edit pages.
  - Added foreman material create/edit pages while keeping the dashboard entry.
  - Added stock in/out server action and form backed by one database transaction.
  - Added owner sidebar navigation for material management.
  - Added unit tests for material search, CRUD, stock transactions, and actions.

## A03 - Product Category Tree Management UI

- Status: `done`
- Priority: P1
- Risk: medium
- Suggested branch: `codex/product-category-tree-ui`
- Scope:
  - Add owner UI for `ProductCategoryNode` list/create/edit/disable/sort.
  - Keep `Product.category` legacy enum snapshot behavior unchanged.
  - Do not rewrite historical product categories.
- Acceptance:
  - Disabled categories cannot be selected for new products.
  - Products already using a disabled category keep rendering safely.
  - Category path uniqueness and ltree validation errors are translated clearly.
- Delivered:
  - Added owner product category list/create/edit pages.
  - Added product category node server actions, form, table, and active toggle.
  - Added schema validation for `product.*` ltree-safe paths and sort order.
  - Added path uniqueness and ltree constraint error translation.
  - Updated product edit category options to include the product's existing
    inactive category while new product creation only lists active categories.
  - Added unit tests and smoke coverage for product category management.

## A04 - Price Dictionary Management UI

- Status: `done`
- Priority: P1
- Risk: medium-high
- Suggested branch: `codex/price-dictionary-ui`
- Scope:
  - Add owner UI for `PriceTier` and `PriceAdjustment`.
  - Surface database errors for overlapping effective windows.
  - Keep automatic quote calculation out of scope unless separately requested.
- Acceptance:
  - Same product + minQty overlapping validity periods are rejected.
  - `PriceAdjustment.triggerCondition` only accepts JSON object input.
  - Existing order amount entry remains manual.
- Delivered:
  - Added `/owner/prices` owner UI with separate price tier and price
    adjustment tables.
  - Added create/edit flows for `PriceTier` and `PriceAdjustment`.
  - Added `PriceAdjustment` active toggle while keeping basic edit separate from
    activation state.
  - Added Zod schemas for price tiers, effective windows, money fields, and JSON
    object trigger conditions.
  - Added Server Action error translation for overlapping effective windows and
    JSON object database constraints.
  - Added unit tests for price lib/actions and smoke coverage for the price
    dictionary entry.

## A05 - Order Item-Level Edit

- Status: `needs-owner-input`
- Priority: P1
- Risk: high
- Suggested branch: `codex/order-item-edit`
- Needs:
  - Confirm which statuses allow item add/remove/edit.
  - Confirm how design files should be added/removed after submit.
  - Confirm whether amount recalculation is automatic or manual after edits.
- Scope Draft:
  - Extend `/orders/[id]/edit` beyond current header/receiver fields.
  - Write item-level `OrderLog` diffs.
  - Preserve current status machine and ownership gates.

## A06 - OSS STS And Real CDR Bundle Upload

- Status: `done`
- Priority: P1
- Risk: medium
- Suggested branch: `codex/oss-sts-cdr-real-upload`
- Needs (resolved 2026-07-05):
  - OSS: bucket `hongbaowebdb`, region `oss-cn-guangzhou`, no CDN; RAM role
    `erp-oss-upload` + sub-account AK in server `.env`.
  - SDK: `ali-oss` (single package for STS + object ops) + `archiver` for ZIP.
- Delivered:
  - Replaced `lib/oss/sign.ts` stub with real `OSS.STS.assumeRole`; session
    policy scoped to the single minted objectKey, 1h expiry; AssumeRole and
    config-parse failures fold into `{ status: 'error' }` (four-state union
    stays exhaustive; SDK errors go to server logs only).
  - Replaced CDR mock ZIP with streaming get -> archiver -> putStream
    `bundles/<id>.zip` + 24h signed GET URL (long-term sub-account creds;
    STS tokens max 1h cannot sign 24h links). `expiresAt` aligned to sign time.
  - `CDR_BUNDLE_MOCK_MODE`: unset -> real only in production; dev/E2E default
    mock even with real creds. Malformed `OSS_ENDPOINT` degrades to mock
    instead of 500ing `/foreman/cdr`.
  - Live smoke against real Aliyun: AssumeRole / temp-cred PUT `design/*` /
    session-policy escape guard all passed.
- Verified 2026-07-05 (after owner attached `print-shop-erp-oss-object-rw`
  to RAM user `webhongbao`):
  - Full live smoke green: AssumeRole, temp-cred PUT `design/*`, escape
    guard, direct GET `design/*`, direct PUT `bundles/*`, 24h signed URL.
  - Real `uploadBundleZip` end-to-end: streamed two `design/*` objects
    through archiver into `bundles/*`, downloaded via signed URL, ZIP magic
    verified.

## A07 - Notification Per-User Routing

- Status: `needs-owner-input`
- Priority: P2
- Risk: medium
- Suggested branch: `codex/notification-per-user-routing`
- Needs:
  - Confirm whether each CS/worker has a private webhook/channel.
  - Confirm fallback channel if a user-specific channel is missing.
- Scope Draft:
  - Add user/channel mapping.
  - Route CS period messages to the related CS user when configured.

## A08 - Pigsty Production Activation Runbook

- Status: `done`
- Priority: P1
- Risk: low
- Suggested branch: `codex/pigsty-production-runbook`
- Scope:
  - Add runbooks for installing/preloading `pg_pinyin`, `pg_bigm`, `pg_ivm`,
    `pg_cron`, `pg_net`, `pg_stat_statements`, `anon`, `pgaudit`, and
    `pg_partman` in Pigsty.
  - Include exact SQL checks against `/owner/pigsty` readiness views.
  - Do not run production operations.
- Acceptance:
  - Runbook separates cluster restart steps from normal migrations.
  - Runbook documents rollback/disable path for cron jobs and audit logging.
- Delivered:
  - Added `docs/pigsty-production-activation-runbook.md`.
  - Documented Pigsty package/install, preload/restart, extension creation, app
    settings, migration timing, readiness SQL, cron scheduling, and rollback.
  - Added exact SQL checks for search, scheduler, observability, security,
    sensitive-column masking, audit tables, inventory summaries, and partition
    readiness.
  - Linked the runbook from README and updated Pigsty extension status.

## A09 - Partition Cutover For Growing Tables

- Status: `manual-ops-only`
- Priority: P2
- Risk: high
- Suggested branch: `codex/partition-cutover-runbook`
- Scope:
  - Only write a cutover plan for `MaterialTransaction`, `OrderLog`, and
    `NotificationLog`.
  - Do not rewrite tables automatically.
- Acceptance:
  - Plan covers primary key changes, incoming foreign keys, backfill, validation,
    and rollback.
- Delivered (plan only; execution stays manual-ops-only):
  - Added `docs/partition-cutover-plan.md` covering composite primary key
    changes, incoming foreign key verification SQL, per-month backfill,
    rename-swap cutover, validation queries, retention config, and rollback.
  - Verified in current schema that no table holds an incoming foreign key to
    the three candidates; the plan requires re-checking before execution.
  - Prisma composite-`@@id` model changes and `findUnique`-by-id call-site
    sweep are documented as part of the same cutover PR.

## A10 - Backup And Deployment Smoke Automation

- Status: `done`
- Priority: P1
- Risk: low
- Suggested branch: `codex/deploy-smoke-checklist`
- Scope:
  - Add scripts/docs for local smoke commands:
    migration status, seed, cron endpoint auth check, build, and route checks.
  - Add pgbackrest checklist placeholders for Pigsty production.
  - Do not require production secrets in CI.
- Acceptance:
  - A developer can run one documented command sequence before deployment.
  - The checklist includes PDF browser install and notification mock-mode checks.
- Delivered:
  - Added `scripts/deploy-smoke.mjs` and `pnpm deploy:smoke`.
  - Added `docs/deployment-smoke-checklist.md` with local command sequence,
    migration status, optional seed, cron auth, route checks, PDF browser,
    notification mock-mode, and pgBackRest placeholders.
  - Kept production secrets optional; the script uses invalid cron auth for
    endpoint checks and defaults seed to off.

## A11 - Open Source ERP And Admin Adoption Planning

- Status: `done`
- Priority: P0
- Risk: low
- Suggested branch: `codex/erp-admin-adoption-planning`
- Scope:
  - Review Odoo, ERPNext, Apache OFBiz, and OpenBoxes for current project fit.
  - Create `docs/open-source-erp-review.md`.
  - Create `docs/SOYBEANADMIN-ADOPTION.md`.
  - Create `docs/ADMIN-FRAMEWORK-PLAN.md`.
  - Convert the resulting roadmap into follow-up automation tasks.
- Acceptance:
  - The review explains why full ERP forks are not imported directly.
  - The module plan covers customer/supplier, sales orders, purchase orders,
    material inventory, warehouses/locations, stock ledger, production orders,
    BOM/material usage, receivables/payables, and audit logs.
  - The SoybeanAdmin plan keeps Next.js Server Actions, Prisma, PostgreSQL, and
    current RBAC.
- Delivered:
  - Added open-source ERP review and domain extraction plan.
  - Added SoybeanAdmin adoption plan.
  - Added internal admin framework plan.
  - Added follow-up backlog items for framework and ERP module implementation.

## A12 - Internal Admin CRUD And Action Result Foundation

- Status: `done`
- Priority: P0
- Risk: medium
- Suggested branch: `codex/admin-crud-action-foundation`
- Scope:
  - Add a shared mutation result type and helpers for Zod field errors, FormData
    string normalization, Prisma unique violation mapping, and path
    revalidation.
  - Document the standard CRUD module file layout from
    `docs/ADMIN-FRAMEWORK-PLAN.md`.
  - Migrate one low-risk dictionary module helper path as proof, preferably
    product or material actions, without changing user-facing behavior.
  - Keep current Server Actions and Prisma modules.
- Acceptance:
  - Existing product/material/craft action tests still pass.
  - At least one module uses the shared action helper contract.
  - No route, schema, or database behavior changes are introduced.
- Delivered:
  - Added `lib/admin/action-helpers.ts` with shared mutation result, validation,
    FormData, Prisma unique error, invariant error, and revalidation helpers.
  - Added unit tests for the shared helpers.
  - Migrated material owner actions to the shared helper contract as proof.
  - Documented the CRUD action contract in `docs/ADMIN-FRAMEWORK-PLAN.md`.

## A13 - Internal Admin Data Table Foundation

- Status: `done`
- Priority: P0
- Risk: medium
- Suggested branch: `codex/admin-data-table-foundation`
- Scope:
  - Add reusable admin table primitives for search, empty state, pagination,
    sort links, filter slots, status display, and row actions.
  - Migrate one existing list page as proof, preferably `owner/materials` or
    `owner/products`.
  - Keep URL-based query params for search/sort/page state.
- Acceptance:
  - The migrated page has equivalent behavior and passes smoke checks.
  - The table primitive does not require a client-side SPA data layer.
  - Large result sets can be paginated by future modules.
- Delivered:
  - Added `lib/admin/table.ts` with URL query parsing, sort toggling, href
    building, and pagination helpers.
  - Added `components/business/admin/AdminDataTable.tsx` with reusable search,
    table card, sortable header, pagination, status badge, and row action
    primitives.
  - Migrated `/owner/materials` to the shared table primitives.
  - Added paginated/sortable material listing service and tests.

## A14 - Admin Module Metadata Registry

- Status: `done`
- Priority: P1
- Risk: medium
- Suggested branch: `codex/admin-module-metadata-registry`
- Scope:
  - Introduce a module metadata registry for label, route base, icon,
    permission, role visibility, breadcrumb label, menu section, and status.
  - Refactor sidebar/menu tests to read from the registry where appropriate.
  - Preserve existing permission dictionary as the source of authorization
    truth.
- Acceptance:
  - Sidebar active state and visible menu items remain unchanged.
  - Missing permission/menu wiring is covered by tests.
  - Placeholder pages and implemented pages are explicit in metadata.
- Delivered:
  - Added `lib/navigation/admin-modules.ts` as the admin module metadata
    registry for labels, route bases, icons, permissions/roles, breadcrumb
    labels, menu section, order, and implemented/placeholder status.
  - Refactored `lib/navigation/admin-menu.ts` to derive sidebar items from the
    registry while preserving `PERMISSIONS` as the authorization source of truth.
  - Extended navigation tests to cover registry id uniqueness, permission keys,
    placeholder vs implemented route states, and App Router page wiring.

## A15 - Soybean-Inspired Admin Shell POC

- Status: `done`
- Priority: P1
- Risk: medium
- Suggested branch: `codex/soybean-inspired-admin-shell-poc`
- Scope:
  - Improve admin shell ergonomics using `docs/SOYBEANADMIN-ADOPTION.md` as the
    reference.
  - Refine sidebar grouping, density, and active state presentation.
  - Refine header user menu, role display, quick links, and optional environment
    indicator.
  - Add lightweight quick navigation or page tabs only if it can be done inside
    the existing Next.js shell.
  - Do not change business routes, auth, permissions, Prisma, or Server Actions.
- Acceptance:
  - Existing auth and sidebar tests pass.
  - Playwright smoke covers no Next error overlay after shell changes.
  - The POC includes screenshots or route checks in the PR body.
- Delivered:
  - Sidebar now uses registry-backed module sections for grouped navigation.
  - Header now includes role-aware quick links and a non-secret environment
    indicator.
  - Sidebar active state has a clearer active treatment while preserving route
    matching and placeholder behavior.
  - Breadcrumb labels were extended for recently added product category, price,
    material, notification, and Pigsty routes.
  - Navigation tests cover grouped menu output and implemented quick links.

## A16 - Customer And Supplier Master Data

- Status: `done`
- Priority: P1
- Risk: medium-high
- Suggested branch: `codex/party-master-data`
- Scope:
  - Add `Party`, `PartyContact`, and `PartyAddress` models for customers and
    suppliers.
  - Add owner CRUD UI using the internal admin framework if A12/A13 are done.
  - Add search by code, name, contact, phone, address, and pinyin fields.
  - Keep current order customer and receiver snapshot fields.
- Acceptance:
  - Existing orders render without party links.
  - New orders can optionally select a party and copy default contact/address.
  - Party disable does not break historical orders.
- Delivered:
  - Added `Party`, `PartyContact`, and `PartyAddress` models plus optional
    `Order.customerPartyId` while preserving order customer/receiver snapshot
    fields.
  - Added owner CRUD pages under `/owner/parties` with search, pagination,
    sorting, type filtering, default contact/address editing, and enable/disable.
  - Added party search across code, name, short name, contact, phone, address,
    and pinyin fields.
  - Added new-order customer party selection that copies code, default contact,
    phone, and address into existing snapshot fields.
  - Added permission/menu/breadcrumb wiring and unit tests for schemas,
    navigation, actions, party business logic, and order party validation.
- Follow-up (2026-07-31): removed the low-usage customer-party selector from
  sales-order creation. Orders now use their snapshot fields directly;
  historical links and purchasing supplier selection remain intact.

## A17 - Purchase Orders And Purchase Receipts

- Status: `done`
- Priority: P1
- Risk: high
- Suggested branch: `codex/purchase-orders-receipts`
- Scope:
  - Add purchase order and receipt models for material purchasing.
  - Add supplier party linkage.
  - Receiving material creates `MaterialTransaction` with direction `IN` in the
    same transaction.
  - Keep costing simple; do not implement accounting-grade payable posting in
    this task.
- Acceptance:
  - Partial receipts are supported.
  - Receipt cancellation/adjustment rules are explicit.
  - Inventory cannot be changed without a ledger row.
- Delivered:
  - Added purchase order, purchase order item, purchase receipt, and purchase
    receipt item models with supplier party linkage and supplier snapshots.
  - Added owner purchase order list/create/detail pages under
    `/owner/purchases`.
  - Added partial purchase receipt posting that locks stock rows, updates
    `Material.currentStock`, and writes `MaterialTransaction` with
    `PURCHASE_RECEIPT` in the same transaction.
  - Added receipt cancellation that refuses negative inventory, marks the
    receipt cancelled, rolls back received quantity, and writes a reversing
    `PURCHASE_RECEIPT_CANCEL` material transaction.
  - Added permission/menu/breadcrumb wiring, unit tests for purchase invariants,
    schema tests, and smoke route coverage for purchase pages.

## A18 - Warehouse Location And Stock Ledger Extension

- Status: `done`
- Priority: P1
- Risk: high
- Suggested branch: `codex/warehouse-location-stock-ledger`
- Scope:
  - Add warehouse and location models.
  - Extend stock ledger planning for location-level stock.
  - Keep `Material.currentStock` as a summary during transition.
  - Add migration and backfill plan for existing material stock.
- Acceptance:
  - Single-location current behavior remains valid.
  - New stock movements can be linked to locations.
  - Negative inventory remains rejected unless an explicit owner override is
    designed.
- Delivered:
  - Added `Warehouse`, `WarehouseLocation`, and `MaterialLocationStock` models
    plus an A18 migration that creates a default warehouse/default location,
    backfills material stock, and links historical material transactions to the
    default location.
  - Extended stock movement posting to resolve default or selected locations,
    update `Material.currentStock` and per-location stock in one transaction,
    and continue rejecting negative summary or location inventory.
  - Added owner warehouse/location management under `/owner/warehouses` with
    permission/menu/breadcrumb wiring.
  - Added location selectors to manual material stock movements and purchase
    receipts; receipt cancellation reverses stock from the original receipt
    location.
  - Added owner/foreman material detail location-stock tables.
  - Added warehouse/action tests and smoke coverage for warehouse and location
    stock pages.

## A19 - BOM And Material Usage Planning

- Status: `done`
- Priority: P1
- Risk: high
- Suggested branch: `codex/bom-material-usage`
- Scope:
  - Add BOM and BOM item models for products or product category nodes.
  - Add owner BOM management UI.
  - Add read-only material usage estimate for order/order item detail.
  - Do not automatically issue stock until owner approves the production issue
    workflow.
- Acceptance:
  - BOM versioning or activation rules are explicit.
  - Disabled BOMs are not used for new estimates.
  - Historical estimates remain explainable.
- Delivered:
  - Added `BillOfMaterial` and `BillOfMaterialItem` models plus an A19
    migration with exact-one-target, positive quantity, version uniqueness, and
    one-active-BOM-per-product/category constraints.
  - Added owner BOM management under `/owner/boms` with create/list/detail and
    enable/disable flows.
  - Added `bom:manage` permission, menu, breadcrumb, and navigation tests.
  - Added read-only material usage estimates on order detail; estimates prefer
    product BOMs and fall back to category BOMs, while clearly avoiding
    automatic stock issue.
  - Added BOM business/action unit tests and smoke coverage for BOM pages and
    order material estimates.

## A20 - Production Order Separation

- Status: `needs-owner-input`
- Priority: P1
- Risk: high
- Suggested branch: `codex/production-order-separation`
- Needs:
  - Confirm whether production orders are created per order, order item, or
    batch.
  - Confirm whether existing production tasks should migrate immediately or only
    new tasks use production orders.
  - Confirm material issue timing: scheduling, task start, task completion, or
    manual issue.
- Scope Draft:
  - Add `ProductionOrder` as the internal execution layer.
  - Keep current scheduling pages as entry points.
  - Link material issue rows to stock transactions.

## A21 - Receivables And Payables Expansion

- Status: `needs-owner-input`
- Priority: P1
- Risk: high
- Suggested branch: `codex/receivable-payable-expansion`
- Needs:
  - Confirm whether this system should remain lightweight billing or become
    accounting-grade.
  - Confirm payable approval and payment workflow.
  - Confirm whether supplier payable aging is required.
- Scope Draft:
  - Keep existing bill/payment behavior.
  - Add supplier payable records from purchase orders.
  - Do not add a general ledger unless explicitly approved.

## A22 - Audit Log Standardization

- Status: `done`
- Priority: P1
- Risk: medium
- Suggested branch: `codex/audit-log-standardization`
- Scope:
  - Add a shared audit log helper for cross-domain actions.
  - Standardize actor, action, entity type, entity id, before/after diff,
    request metadata, and timestamp.
  - Keep existing domain logs working.
  - Treat `pgaudit` as database-level production support, not a replacement for
    business audit logs.
- Acceptance:
  - At least one existing domain action writes through the helper.
  - Tests verify audit payload shape.
  - Sensitive fields are masked where needed.
- Delivered:
  - Added `BusinessAuditLog` plus A22 migration for actor snapshots, action,
    entity type/id, before/after payloads, diff, request metadata, and
    timestamp.
  - Added `lib/audit-log.ts` shared helper for payload sanitization, diff
    generation, and write-through persistence.
  - Connected `updatePartyAction` to the shared business audit log while
    keeping existing domain logs untouched.
  - Added tests for standardized payload shape, request metadata, raw-change
    diffing, and masking of sensitive values such as phone, WeChat, address,
    password, token, and secret fields.
  - Documented in migration comments that this complements Pigsty `pgaudit`
    rather than replacing business audit logs.

## A23 - Complex Client Data Layer POC

- Status: `done`
- Priority: P2
- Risk: medium-high
- Suggested branch: `codex/complex-client-data-layer-poc`
- Scope:
  - Pick one complex page candidate: production scheduling, inventory count,
    batch material issue, bulk order edit, or price sheet editing.
  - Add a client-component island and route handlers under `/api/admin/*` only
    for that page.
  - Consider TanStack Query only if the selected page needs polling,
    optimistic updates, or complex cache invalidation.
  - Keep normal CRUD on Server Actions.
- Acceptance:
  - The POC does not introduce a second auth model.
  - Route handlers enforce the same permissions as Server Actions.
  - Existing non-complex CRUD pages remain server-action based.
- Delivered:
  - Picked inventory count as the complex-page POC and added
    `/owner/materials/count`.
  - Added a scoped client-component island for searching materials, reviewing
    warehouse/location stock, entering local count values, and calculating
    count differences without writing stock changes.
  - Added `/api/admin/inventory-count/materials` under `/api/admin/*`; the
    route handler reuses `requirePermission('material:manage')` and returns
    `401` for the existing unauthorized path instead of introducing a second
    auth model.
  - Kept normal material CRUD on Server Actions; the API route is limited to
    this complex inventory-count read model.
  - Deferred TanStack Query because this read-only POC has no polling,
    optimistic update, or cross-view cache invalidation requirement yet.
  - Added focused unit/route tests and smoke coverage for the inventory count
    page.
