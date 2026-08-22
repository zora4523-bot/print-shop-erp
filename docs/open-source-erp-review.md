# Open Source ERP Review

Date: 2026-06-29

This review evaluates whether existing open source ERP projects should be
forked into this project, integrated as side systems, or used as design
references for the current Next.js + Prisma + PostgreSQL ERP.

## Executive Decision

Do not fork a full ERP into this repository.

Use Odoo, ERPNext, Apache OFBiz, and OpenBoxes as domain references, then
implement the selected modules inside the current architecture:

- Next.js App Router
- Server Actions for normal forms and mutations
- Prisma over PostgreSQL
- Auth.js session auth
- App-level RBAC via `lib/auth/permissions-dict.ts`
- Pigsty/PostgreSQL extensions where they reduce operational complexity

The current project already has order, product, material, inventory, bill,
salary, notification, and audit foundations. Forking a full ERP would duplicate
auth, permissions, database ownership, UI shell, workflow state machines, and
deployment operations.

## Reviewed Projects

| Project | Stack | License posture | Best use for this project | Fork fit |
| --- | --- | --- | --- | --- |
| Odoo Community | Python, PostgreSQL, Odoo framework | LGPL-3.0 oriented community codebase | Sales, purchase, stock, manufacturing, accounting model reference | Low |
| ERPNext | Python, Frappe, MariaDB | GPL-3.0 oriented ERP app | Manufacturing, material, HR/payroll, receivable/payable reference | Low |
| Apache OFBiz | Java, OFBiz framework | Apache-2.0 | Broad ERP data model and process reference; license-friendly reading | Low-medium |
| OpenBoxes | Groovy/Grails, inventory-focused app | Open source inventory system; verify exact license before reuse | Warehouse, stock movement, transfer, lot/location concepts | Low |

Sources checked:

- Odoo repository: https://github.com/odoo/odoo
- Odoo source install documentation: https://www.odoo.com/documentation/19.0/administration/on_premise/source.html
- ERPNext repository: https://github.com/frappe/erpnext
- Frappe framework repository: https://github.com/frappe/frappe
- Apache OFBiz repository: https://github.com/apache/ofbiz-framework
- Apache OFBiz site: https://ofbiz.apache.org/
- OpenBoxes repository: https://github.com/openboxes/openboxes
- OpenBoxes site: https://openboxes.com/

## Why Full Forking Does Not Fit

### Duplicated platform concerns

A full ERP fork brings its own:

- user model
- permissions
- session/auth stack
- routing
- UI shell
- database migration system
- workflow engine
- module registry
- test and deployment conventions

Those overlap with the current project instead of extending it.

### Domain mismatch

The current ERP is for a print shop. It needs:

- fast order entry
- customer code / receiver / phone / express / order fuzzy search
- design file and CDR bundling
- production scheduling
- outsource tracking
- material and finished-stock inventory
- piecework and hourly salary
- lightweight receivable/payable support

Generic ERP projects are broader, but their default workflows would still need
heavy localization for this business.

### Operational cost

Running another ERP stack means separate upgrades, security patching, backups,
observability, user provisioning, and integration contracts. That cost is higher
than implementing selected modules in the existing system.

## Extracted Module Design

The following module blueprint should be implemented in the current project
rather than imported wholesale from another ERP.

## Customers And Suppliers

Purpose:

- centralize customer and supplier master data
- stop duplicating names, contacts, phones, and addresses on every order
- keep order-level snapshots for historical correctness

Suggested models:

- `Party`
  - `id`
  - `type`: CUSTOMER, SUPPLIER, BOTH
  - `code`
  - `name`
  - `shortName`
  - `searchText`
  - `searchPinyin`
  - `searchPinyinInitials`
  - `isActive`
- `PartyContact`
  - `partyId`
  - `name`
  - `phone`
  - `wechat`
  - `isPrimary`
- `PartyAddress`
  - `partyId`
  - `receiverName`
  - `receiverPhone`
  - `province`
  - `city`
  - `district`
  - `detail`
  - `isDefault`

Integration:

- Orders keep customer and receiver snapshots entered directly on the order.
- The sales-order form does not depend on `Party`; the retained optional
  relation only preserves historical links. Supplier selection remains active
  for purchasing.
- Search uses the existing fuzzy search direction with `pg_trgm`, `pg_bigm`, and
  `pg_pinyin` readiness checks.

## Sales Orders

Purpose:

- evolve the current `Order` into a clearer sales-order workflow without
  breaking existing order pages.

Suggested additions:

- normalized customer link: optional `partyId`
- order source/channel field
- more explicit commercial fields for quote/confirm/produce/ship/settle
- item-level edit roadmap from A05

Implementation rule:

- Keep existing order numbers and status machine stable.
- Add fields and UI incrementally.
- Do not rewrite historical orders.

## Purchase Orders

Purpose:

- manage supplier purchases for paper, foil, bags, and outsourced material.

Suggested models:

- `PurchaseOrder`
  - supplier party
  - status: DRAFT, ORDERED, PARTIAL_RECEIVED, RECEIVED, CANCELLED
  - expected date
  - total amount
- `PurchaseOrderItem`
  - material
  - ordered quantity
  - received quantity
  - unit cost
- `PurchaseReceipt`
  - purchase order
  - receiver user
  - received at
- `PurchaseReceiptItem`
  - material
  - received quantity
  - unit cost

Integration:

- Receiving creates `MaterialTransaction` with direction `IN`.
- Average cost can be updated later by a dedicated costing task.

## Material Inventory

Purpose:

- build on the current material CRUD and stock transaction flow.

Existing foundation:

- `Material`
- `MaterialTransaction`
- `/foreman/materials`
- owner/foreman material create/edit pages

Next improvements:

- standardized stock reason types
- inventory adjustment approval
- safety-stock alerts
- stock value dashboard
- optional `pg_ivm` dashboard refresh path when write volume grows

## Warehouses And Locations

Purpose:

- support physical warehouse/area/shelf/bin tracking.

Suggested models:

- `Warehouse`
  - code
  - name
  - isActive
- `StockLocation`
  - warehouse
  - parent location
  - code
  - name
  - location type: STORAGE, PRODUCTION, SHIPPING, SCRAP
- `StockBalance`
  - material
  - location
  - quantity

Implementation rule:

- Do not add this until single-location inventory starts limiting operations.
- When introduced, keep `Material.currentStock` as a summary or transition field
  until all flows write location-level balances.

## Stock Ledger

Purpose:

- make inventory auditable and scalable.

Suggested model evolution:

- keep `MaterialTransaction` as the stock ledger
- add `locationId` when warehouses are enabled
- add optional links:
  - order
  - purchase receipt
  - production order
  - adjustment approval
- add partition planning with `pg_partman` once ledger volume grows

Rules:

- Ledger rows are append-only.
- Corrections are new adjustment rows, not updates.
- Negative inventory remains rejected unless an explicit owner override exists.

## Production Orders

Purpose:

- separate customer-facing sales order from internal production execution.

Suggested models:

- `ProductionOrder`
  - source order or order item
  - product
  - planned quantity
  - status: DRAFT, RELEASED, IN_PROGRESS, COMPLETED, CANCELLED
- `ProductionTask`
  - can continue from current model
  - links to production order and craft
- `ProductionMaterialIssue`
  - material
  - quantity
  - linked stock transaction

Integration:

- Current scheduling pages can remain the UI entry.
- Production material issue writes `MaterialTransaction` with direction `OUT`.

## BOM And Material Usage

Purpose:

- estimate and later post material consumption based on product and craft.

Suggested models:

- `BillOfMaterial`
  - product or product category node
  - version
  - isActive
- `BillOfMaterialItem`
  - material
  - quantity per product unit or batch
  - waste rate
  - optional craft dependency

Implementation path:

1. Add read-only BOM estimate to order/item detail.
2. Add owner BOM management UI.
3. Add production material issue from BOM.
4. Add variance report between expected and actual usage.

## Receivables And Payables

Purpose:

- extend existing bills without turning this project into a full accounting
  ledger too early.

Suggested direction:

- keep current bill/payment flow for receivables
- add supplier payable records from purchase orders
- avoid general ledger until owner explicitly asks for accounting-grade finance

Safety:

- Any task changing finance-of-record semantics should stay
  `needs-owner-input` until approved.

## Audit Logs

Purpose:

- make operations traceable across orders, inventory, users, and configuration.

Suggested approach:

- keep existing domain logs where present
- add a standard `AuditLog` helper for cross-domain actions
- include actor, action, entity type, entity id, before/after diff, request id,
  and IP/user agent when available
- use `pgaudit` only as production database audit support, not as a replacement
  for business audit logs

## Current Project Roadmap

### Foundation first

Before adding more large ERP modules, build the internal admin framework layer:

1. unified CRUD module template
2. unified table capabilities
3. unified form/action result contract
4. unified menu/permission/page metadata
5. client data layer only for complex screens

### Suggested delivery order

1. Admin framework foundation
2. Customer/supplier master data
3. Purchase order and purchase receipt
4. Warehouse/location and stock ledger extension
5. BOM and material usage
6. Production order separation
7. Receivable/payable expansion
8. Audit log standardization

## Non-Goals

- Do not import Odoo/ERPNext/OFBiz/OpenBoxes runtime code into this repository.
- Do not replace Next.js App Router with a SPA shell.
- Do not introduce accounting-grade ledgers without explicit owner approval.
- Do not execute production database operations from automation routines.
