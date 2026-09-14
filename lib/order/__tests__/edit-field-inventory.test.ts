import fs from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Zod schema 已按域拆到 lib/auth/schemas/ 下（入口 lib/auth/schemas.ts 只做 re-export），
// 这里遍历目录里的全部文件，后续再拆也不需要改本测试。
const SCHEMA_DIR = 'lib/auth/schemas';
const schemaSources = fs
  .readdirSync(SCHEMA_DIR)
  .filter((name) => name.endsWith('.ts'))
  .sort()
  .map((name) => {
    const file = `${SCHEMA_DIR}/${name}`;
    return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  });

it('every create payload leaf is explicitly accounted for in the edit matrix', () => {
  const doc = fs.readFileSync('docs/工单编辑-字段对照表.md', 'utf8');
  const roots: Record<string, string> = { createOrderSchema: '', orderItemBaseSchema: 'items[].', additionalShipmentSchema: 'additionalShipments[].', packagingGroupSchema: 'packagingGroups[].', shipmentChargeFields: '' };
  const fields: string[] = [];
  function visit(node: ts.Node, source: ts.SourceFile) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text in roots && node.initializer) {
      const prefix = roots[node.name.text];
      let object: ts.ObjectLiteralExpression | undefined;
      function find(child: ts.Node) { if (object) return; if (ts.isObjectLiteralExpression(child)) { object = child; return; } ts.forEachChild(child, find); }
      find(node.initializer);
      for (const property of object?.properties ?? []) {
        if (!ts.isPropertyAssignment(property)) continue;
        const field = prefix + property.name.getText(source).replace(/['"]/g, '');
        if (!['items', 'additionalShipments', 'packagingGroups'].includes(field)) fields.push(field);
      }
    }
    ts.forEachChild(node, (child) => visit(child, source));
  }
  for (const source of schemaSources) visit(source, source);
  expect(fields.length).toBeGreaterThan(50);
  for (const field of fields) expect(doc, field).toContain('`' + field.replace(/\[\]$/, '') );
  expect(doc).toContain('| F75 |');
});
