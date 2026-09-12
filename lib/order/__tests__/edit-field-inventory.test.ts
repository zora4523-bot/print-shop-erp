import fs from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('every create payload leaf is explicitly accounted for in the edit matrix', () => {
  const source = ts.createSourceFile('schemas.ts', fs.readFileSync('lib/auth/schemas.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const doc = fs.readFileSync('docs/工单编辑-字段对照表.md', 'utf8');
  const roots: Record<string, string> = { createOrderSchema: '', orderItemBaseSchema: 'items[].', additionalShipmentSchema: 'additionalShipments[].', packagingGroupSchema: 'packagingGroups[].', shipmentChargeFields: '' };
  const fields: string[] = [];
  function visit(node: ts.Node) {
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
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(fields.length).toBeGreaterThan(50);
  for (const field of fields) expect(doc, field).toContain('`' + field.replace(/\[\]$/, '') );
  expect(doc).toContain('| F75 |');
});
