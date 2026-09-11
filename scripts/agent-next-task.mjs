#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const backlogPath = resolve(root, 'docs/AGENT-BACKLOG.md');
const backlog = readFileSync(backlogPath, 'utf8');

const sections = backlog
  .split(/^## /m)
  .slice(1)
  .map((section) => `## ${section.trim()}`);

const tasks = sections
  .filter((section) => /^## A\d+ /.test(section))
  .map((section) => {
    const [heading = ''] = section.split('\n', 1);
    const idMatch = heading.match(/^## (A\d+) - (.+)$/);
    const field = (name) => {
      const match = section.match(new RegExp(`^- ${name}: (.+)$`, 'm'));
      return match?.[1]?.trim() ?? '';
    };

    return {
      id: idMatch?.[1] ?? '',
      title: idMatch?.[2] ?? heading.replace(/^## /, ''),
      status: field('Status').replaceAll('`', ''),
      priority: field('Priority'),
      risk: field('Risk'),
      branch: field('Suggested branch').replaceAll('`', ''),
      body: section,
    };
  });

const list = process.argv.includes('--list');
const priorityRank = (priority) => {
  const match = priority.match(/^P(\d+)$/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

const agentReadyTasks = tasks
  .map((task, index) => ({ task, index }))
  .filter(({ task }) => task.status === 'agent-ready')
  .sort((a, b) => {
    const byPriority = priorityRank(a.task.priority) - priorityRank(b.task.priority);
    return byPriority === 0 ? a.index - b.index : byPriority;
  })
  .map(({ task }) => task);

if (list) {
  for (const task of tasks) {
    console.log(`${task.id}\t${task.status}\t${task.priority}\t${task.title}`);
  }
  process.exit(0);
}

const selected = agentReadyTasks[0];

if (!selected) {
  console.error('No agent-ready task found in docs/AGENT-BACKLOG.md');
  process.exit(1);
}

const prompt = `You are working in ${root}.

Implement the next automation backlog task:

${selected.body}

Execution rules:
1. Read AGENTS.md, CONTRIBUTING.md, DEVELOPMENT.md, docs/编码规范.md, README.md, DECISIONS.md, PIGSTY-EXTENSIONS.md, and docs/AGENT-ROUTINES.md first.
2. Create or use branch ${selected.branch || 'codex/<task>'}.
3. Implement only ${selected.id}. Do not work on other backlog items.
4. Do not execute production database operations or destructive git commands.
5. Select verification by CONTRIBUTING.md#测试要求 and use current commands and environment prerequisites from DEVELOPMENT.md#常用命令 and DEVELOPMENT.md#测试环境约束:
   - Use pnpm lint for the complete ESLint, UI copy, and token gates; plain eslint is insufficient.
   - Run pnpm typecheck and pnpm test --run when required for the change's risk; use pnpm build for the required production build.
   - Run pnpm test:browser and the relevant E2E/visual checks for UI or framework-boundary changes. Playwright --list only collects tests and is not execution.
   - Before any browser test that writes data, explicitly configure an isolated disposable E2E_DATABASE_URL distinct from the daily DATABASE_URL and prepare required fixtures. A missing prerequisite or skipped case is not a pass.
   - For migrations, run pnpm exec prisma validate and pnpm test:migrations:fresh against a confirmed disposable empty database, following DEVELOPMENT.md.
   - Follow the full release-candidate row for release work, including coverage, production dependency audit, production-build browser tests, and target-environment smoke. Never lower gates or update visual baselines merely to pass.
   - Record the tested SHA, working-tree changes, runtime mode, commands, actual pass/fail/skip counts, evidence, and remaining coverage. Synchronize the affected canonical docs and release-remediation task status.
6. Commit the scoped changes and open a draft PR.
7. In the PR body, include summary, tests, risks, and manual follow-up.
`;

console.log(prompt);
