# SoybeanAdmin Adoption Plan

Date: 2026-06-29

## Decision

Use SoybeanAdmin as a UI and admin-experience reference. Do not fork it into the
current project.

The current project should keep:

- Next.js App Router
- React
- Server Actions for normal CRUD mutations
- Prisma over PostgreSQL
- Auth.js session handling
- centralized RBAC in `lib/auth/permissions-dict.ts`

SoybeanAdmin should influence layout, navigation, theme, and admin ergonomics,
not the runtime architecture.

## Reviewed Sources

- SoybeanAdmin repository: https://github.com/soybeanjs/soybean-admin
- SoybeanAdmin docs: https://docs.soybeanjs.cn/
- React/Soybean-style reference mentioned by SoybeanAdmin: https://github.com/Ohh-889/skyroc-admin

SoybeanAdmin mainline is a Vue/Vite admin template. Its strengths are admin
layout, theme, menu, tab, icon, routing, and template ergonomics. Those ideas
are useful, but its Vue/Vite SPA architecture conflicts with this project's
Next.js server-driven architecture.

## Why Not Fork

Forking SoybeanAdmin directly would require:

- replacing the current App Router shell
- rewriting Server Actions as HTTP APIs
- duplicating auth/session state in a SPA client
- syncing permission rules across two layers
- replacing or wrapping existing UI components
- maintaining another routing model

That is high risk and low leverage for this ERP.

## What To Adopt

### Admin shell

- better sidebar grouping
- compact and expanded sidebar states
- clearer active route state
- role-specific menu sections
- quick actions for common workflows

### Header

- user menu
- role badge
- notification entry
- quick links
- optional environment indicator for local/staging/production

### Navigation ergonomics

- page tabs or quick-navigation history
- breadcrumb consistency
- recently visited pages
- module-level search entry

### Theme tokens

- standardized spacing, card, table, and form tokens
- light/dark theme readiness
- semantic colors for warning, success, danger, info
- density presets for data-heavy ERP pages

### Page conventions

- consistent list page layout
- consistent create/edit page layout
- consistent detail page layout
- consistent empty, loading, error, and permission states

## What Not To Adopt

- Vue runtime
- Vite SPA shell
- Pinia-style global store for routine CRUD
- client-only permission routing
- a second login/session system
- a full Ant Design/Naive UI replacement unless selected separately

## POC Scope

The first POC should touch only admin shell and shared UI patterns.

In scope:

- sidebar group and density refinement
- header user menu refinement
- quick navigation or lightweight page tabs
- theme token cleanup
- updated visual QA through Playwright smoke

Out of scope:

- changing business models
- rewriting CRUD pages
- introducing SPA-only routing
- replacing Auth.js
- replacing Prisma/Server Actions

## Implementation Plan

### Phase S1 - Shell inventory

- document current admin shell components
- identify duplicated layout code
- compare current behavior to SoybeanAdmin patterns
- write before/after screenshots

### Phase S2 - Shell POC

- improve sidebar group rendering
- improve header user menu and role display
- add route-aware quick navigation if it can be done without global SPA state
- keep current route permissions unchanged

### Phase S3 - Theme tokens

- normalize card/table/form density tokens
- define semantic color usage
- keep Tailwind-compatible implementation

### Phase S4 - Page conventions

- align CRUD list/create/edit/detail pages to one internal admin framework
- migrate product/material/craft pages gradually

## Acceptance Criteria

- Existing auth and permissions continue to pass tests.
- Existing App Router pages remain server-rendered where they already are.
- No business workflow changes are included in the shell POC.
- Playwright smoke covers login, owner dashboard, material pages, product search,
  Pigsty readiness, and no Next error overlay.
- New visual conventions are documented before broad migration.

## Future SPA Option

If a SPA admin is ever needed, it should be created as a separate app:

- `apps/admin-spa`
- API boundary: `/api/admin/*`
- separate build and deployment pipeline
- explicit auth/session contract

Do not mix a Vite SPA directly into `app/(admin)`.
