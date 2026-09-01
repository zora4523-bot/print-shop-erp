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
1. Read AGENTS.md, README.md, DECISIONS.md, PIGSTY-EXTENSIONS.md, and docs/AGENT-ROUTINES.md first.
2. Create or use branch ${selected.branch || 'codex/<task>'}.
3. Implement only ${selected.id}. Do not work on other backlog items.
4. Do not execute production database operations or destructive git commands.
5. Run verification:
   - ./node_modules/.bin/prisma validate
   - pnpm typecheck
   - ./node_modules/.bin/eslint .
   - ./node_modules/.bin/vitest run --reporter=dot --testTimeout=10000
   - ./node_modules/.bin/next build when App Router, Prisma schema, migrations, or page components change
6. Commit the scoped changes and open a draft PR.
7. In the PR body, include summary, tests, risks, and manual follow-up.
`;

console.log(prompt);
