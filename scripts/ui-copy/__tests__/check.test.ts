import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectUiCopy, scan, policy } from '../check.mjs';

const check = (source: string, exemptions: { file: string; text: string; reason: string }[] = []) =>
  inspectUiCopy(source, 'components/Example.tsx', { ...policy, exemptions });

describe('user-visible copy gate', () => {
  it.each([
    '<p>报价快照</p>',
    '<ReadOnlyInput value="DRAFT" />',
    '<Price basis="PER_UNIT" />',
    'function hint(v){switch(v){case 1:return "Salary";default:return "正常"}} const View=()=> <p>{hint(v)}</p>;',
    '<Input placeholder="填写 settledAt" />',
    '<ConfirmActionDialog action="同步中" changes={[]} consequences={["服务端计价"]} confirmText="保存" />',
    'toast.error("Prisma 错误");',
    'setError("幂等请求失败");',
    'const hint = "DRAFT"; export function View(){ return <p>{hint}</p>; }',
    'const hint = flag ? "快照" : "正常"; export function View(){ return <p>{hint}</p>; }',
    'const hint = `revision ${version}`; export function View(){ return <p>{hint}</p>; }',
    'function hint(){ return "Salary"; } export function View(){ return <p>{hint()}</p>; }',
    'const options = [{value:"draft",label:"DRAFT"}]; export function View(){return <p>{options.map(x=>x.label)}</p>}',
  ])('rejects visible text: %s', (source) => {
    expect(check(source).length).toBeGreaterThan(0);
  });

  it('does not flag comments, logs, enum comparisons, code keys or routes', () => {
    expect(check(`
      // Prisma revision is internal.
      console.error('Prisma migration failed');
      const field = <input type="hidden" value="DRAFT" />;
      const status = 'DRAFT';
      const options = [{value:'DRAFT', label:'草稿', href:'/worker/salary'}];
      export function View(){return <p>{status === 'DRAFT' ? '草稿' : '已结束'}{options.map(x=>x.label)}</p>}
    `)).toEqual([]);
  });

  it('resolves the nearest binding instead of unrelated functions with the same name', () => {
    expect(check(`
      function internal(){const label='Prisma'; console.log(label);}
      function View(){const label='工单';return <p>{label}</p>}
    `)).toEqual([]);
    expect(check(`
      function View(){const label='Prisma';return <p>{label}</p>}
      function internal(){const label='工单'; console.log(label);}
    `)).toHaveLength(1);
  });

  it('exempts only the exact file and text with a nonempty reason', () => {
    const exemption = {file:'components/Example.tsx', text:'Prisma 扩展检查', reason:'管理员数据库诊断入口需要显示实际组件名称'};
    expect(check('<p>Prisma 扩展检查</p>', [exemption])).toEqual([]);
    expect(check('<p>Prisma 业务导语</p>', [exemption])).toHaveLength(1);
    expect(check('<p>Prisma 扩展检查</p>', [{...exemption, file:'components/Other.tsx'}])).toHaveLength(1);
    expect(check('<p>Prisma 扩展检查</p>', [{...exemption, reason:''}])).toHaveLength(1);
  });
});


// This creates a real TypeScript program and resolves imported source files.
// Cold compiler startup on the hosted runner is not a five-second SLA.
it('traces imported display helpers and labels to their defining file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ui-copy-import-'));
  try {
    mkdirSync(path.join(root, 'components'));
    mkdirSync(path.join(root, 'lib'));
    writeFileSync(path.join(root, 'components', 'Example.tsx'), `
      import { label, describe } from '../lib/labels';
      export function View() { return <p>{label}{describe()}</p>; }
    `);
    writeFileSync(path.join(root, 'lib', 'labels.ts'), `
      export const label = 'DRAFT';
      export function describe() { return '服务端快照'; }
      console.log('Prisma debug');
    `);
    const hits = scan(root, {...policy, exemptions: []});
    expect(hits.map(row => row.text).sort()).toEqual(['DRAFT', '服务端快照']);
    expect(hits.every(row => row.file === 'lib/labels.ts')).toBe(true);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}, 20_000);

it('keeps every documented internal mapping in the gate and wires the required lint command', () => {
  const doc = readFileSync(path.join(process.cwd(), 'docs/ui-规范.md'), 'utf8');
  const mappings = doc.split('### 业务词映射')[1].split('### 文案门禁')[0];
  for (const row of mappings.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| 内部词'))) {
    expect(policy.banned).toContain(row.split('|')[1].trim());
  }
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  expect(pkg.scripts.lint).toContain('node scripts/ui-copy/check.mjs');
});

it('blocks connection implementation terms in notification flows without banning diagnostic vocabulary globally', () => {
  expect(inspectUiCopy('<p>后台 worker 将使用 Secret</p>', 'components/business/notification/Example.tsx')).toHaveLength(1);
  expect(inspectUiCopy('<p>Secret 轮换状态</p>', 'app/(admin)/owner/diagnostics/page.tsx')).toEqual([]);
});


it.each([
  ['components/business/order/OrderExportControls.tsx', '由独立重任务生成，不占用 SSR 进程'],
  ['components/business/bom/OrderMaterialUsageEstimate.tsx', '仅按当前启用 BOM 估算'],
  ['app/(admin)/orders/[id]/page.tsx', '计件工资生成后，关联明细会显示在这里'],
])('rejects retired order introductions in %s', (file, copy) => {
  expect(inspectUiCopy(`<p>${copy}</p>`, file, policy).length).toBeGreaterThan(0);
});
it('allows required order blockers and attachment warnings', () => {
  expect(inspectUiCopy('<p>完工后才可发货。图片和 CDR 文件不会保存在本地草稿中。</p>', 'components/business/order/OrderForm.tsx', policy)).toEqual([]);
});

describe('pattern rules (ui-review #30)', () => {
  it.each([
    ['<p>完成于 finishedAt</p>', 'finishedAt'],
    ['<Badge label="legacy 规则" />', 'legacy'],
    ['<p>Legacy 价格</p>', 'Legacy'],
    ['<p>价目簿 v2</p>', 'v2'],
    ['<p>V2版工价</p>', 'V2'],
    ['<p>发给 worker</p>', 'worker'],
    ['toast.error("Worker 不在线");', 'Worker'],
  ])('rejects %s', (source, word) => {
    const [hit] = check(source);
    expect(hit?.words).toContain(word);
  });

  it.each([
    '<p>师傅端</p>',
    '<p>workers 队列</p>',
    '<p>iv2x</p>',
    '<p>PDF 与 CDR</p>',
    '<p>Finished</p>',
    'const x = <a href="/worker/tasks">师傅</a>;',
    'const x = <Form action="/worker/orders">筛选</Form>;',
  ])('accepts %s', (source) => {
    expect(check(source)).toEqual([]);
  });

  it('bans notification credentials copy on the owner notifications pages too', () => {
    const rule = policy.scopedBanned.find((entry: { prefix: string }) => entry.prefix === 'app/(admin)/owner/notifications/');
    expect(rule?.words).toEqual(expect.arrayContaining(['Bot ID', 'Secret']));
    expect(inspectUiCopy('<p>填写 Bot ID</p>', 'app/(admin)/owner/notifications/page.tsx', policy)).toHaveLength(1);
    expect(inspectUiCopy('<p>填写 Bot ID</p>', 'app/(admin)/owner/orders/page.tsx', policy)).toEqual([]);
  });
});

describe('pattern rule precision', () => {
  it('treats bare identifier literals as code keys but still flags them as JSX text', () => {
    expect(check("const f = [['receiverName', '收件人']]; export const V = () => <p>{f.map(x => x[1])}</p>;")).toEqual([]);
    expect(check('setError("externalSalesUserId", { message: "请选择外部销售" });')).toEqual([]);
    expect(check('<th>finishedAt</th>')).toHaveLength(1);
  });

  it('flags identifier literals placed directly in display positions', () => {
    expect(check('const x = <th>{"finishedAt"}</th>;')).toHaveLength(1);
    expect(check('const x = <button aria-label="finishedAt">x</button>;')).toHaveLength(1);
    expect(check('const x = <p title={"settledTotal"}>x</p>;')).toHaveLength(1);
    expect(check('const ok = true; const x = <span>{ok ? "finishedAt" : "创建时间"}</span>;')).toHaveLength(1);
    expect(check('const x = <span>{("finishedAt")}</span>;')).toHaveLength(1);
    expect(check('const ok = true; const x = <button aria-label={ok ? "settledTotal" : "合计"}>x</button>;')).toHaveLength(1);
    expect(check('const ok = true; const x = <span>{ok && "finishedAt"}</span>;')).toHaveLength(1);
    expect(check('const ok = true; const x = <span>{ok ? ("finishedAt" as const) : "创建时间"}</span>;')).toHaveLength(1);
    expect(check('const ok = true; const x = <span>{ok && ("finishedAt" satisfies string)}</span>;')).toHaveLength(1);
  });

  it('does not treat the left side of && as display copy', () => {
    expect(check('const ok = true; const x = <span>{(ok ? "finishedAt" : undefined) && "完成时间"}</span>;')).toEqual([]);
    expect(check('const ok = true; const x = <span>{(ok ? "DRAFT" : undefined) && "草稿"}</span>;')).toEqual([]);
    expect(check('const ok = true; const x = <span>{(ok ? "worker 状态" : undefined) && "处理中"}</span>;')).toEqual([]);
    // || 的左侧为真时会被显示，仍需检查。
    expect(check('const x = <span>{"DRAFT" || "草稿"}</span>;')).toHaveLength(1);
  });

  it('ignores literals that only appear in erased type positions', () => {
    expect(check('const x = <span>{"草稿" satisfies "草稿" | "DRAFT"}</span>;')).toEqual([]);
    expect(check('const x = <span>{"草稿" as "草稿" | "DRAFT"}</span>;')).toEqual([]);
    expect(check('const x = <span>{"DRAFT" as string}</span>;')).toHaveLength(1);
  });

  it('ignores inline script source', () => {
    expect(check('<script>{`localStorage.getItem("x")`}</script>')).toEqual([]);
    expect(check('<Script id="t">{`localStorage.getItem("x")`}</Script>')).toEqual([]);
  });
});
