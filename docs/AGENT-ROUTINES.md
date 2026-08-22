# Agent Routines

This project can use routines to produce automated draft PRs, but the routine
must be constrained. The routine should automate prompt selection, branch
creation, implementation, verification, commit, push, and draft PR creation.
It must not auto-merge and must not execute production operations.

## Recommended Routine

- Name: `print-shop-erp-next-agent-pr`
- Cadence: daily on workdays, or manually triggered when the owner wants the next
  backlog item implemented.
- Timezone: Asia/Shanghai.
- Input source: `docs/AGENT-BACKLOG.md`.
- Output: one draft PR per run.
- Branch prefix: `codex/`.

## Routine Prompt

```text
You are working in /Users/zhixing/我的项目/print-shop-erp.

Goal:
Pick and implement the next safe automation task from docs/AGENT-BACKLOG.md.

Rules:
1. Read AGENTS.md, README.md, DECISIONS.md, PIGSTY-EXTENSIONS.md, and the selected backlog item.
2. Select the highest-priority item with Status: `agent-ready`; for equal
   priority, keep file order.
3. Implement only that item. Do not work on tasks marked `needs-owner-input` or `manual-ops-only`.
4. Preserve the existing architecture: Next.js App Router, Prisma, PostgreSQL, Auth.js, and app-level RBAC.
5. Do not execute production database operations, destructive git commands, or automatic merges.
6. If the item touches App Router, read the relevant local Next.js docs under node_modules/next/dist/docs before editing.
7. Create a branch using the item's Suggested branch.
8. Run the verification commands listed in docs/AGENT-BACKLOG.md.
9. Commit the scoped changes and open a draft PR with:
   - goal
   - implementation summary
   - verification output
   - risks and manual follow-up

Stop and ask for owner input if the task requires credentials, production access,
or unresolved business rules.
```

## Local Prompt Generator

Run:

```bash
pnpm agent:next
```

The command prints the selected backlog item and a ready-to-paste prompt. A
routine can call the same command before starting work.

## Safety Gates

The routine must fail closed when any gate is missing:

- No `agent-ready` backlog item exists.
- Git worktree contains unrelated uncommitted changes that overlap the task.
- Required verification commands fail.
- The task needs credentials or production database access.
- The task would change payroll or finance-of-record semantics without explicit
  owner approval.

## PR Policy

Automated PRs must be draft PRs. A human review is required before merge.

The PR body must include:

- Selected backlog item id.
- Files changed.
- Database migration impact.
- Commands run.
- Screenshots or route checks for UI tasks.
- Known blockers or owner decisions needed.

## What Routines Can Automate

- Picking the next task.
- Creating a scoped branch.
- Editing code and tests.
- Running local validation.
- Creating a commit.
- Pushing the branch.
- Opening a draft PR.

## What Routines Must Not Automate

- Merging PRs.
- Running production Pigsty operations.
- Enabling cron jobs in production.
- Applying `anon` anonymization to a real database.
- Partition cutovers.
- Payroll or billing rule changes without owner confirmation.
- Adding real OSS or webhook credentials to the repository.
