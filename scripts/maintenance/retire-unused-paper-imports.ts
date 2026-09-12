/** One-off repair for the August 2026 imported catalog. Never merge used materials. */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { catalogPaperPricingFacts } from '../../lib/order/create-order-quote-facts-adapter';
import { PRICE_RULE_SNAPSHOT_LOCK_KEY } from '../../lib/price/rule-snapshot-lock';

export const obsoletePaperImports = [
  ['mat_paper_4d8d4ee3bb3732e866bd6b7b', 'PAPER-4D8D4EE3BB37', '160克冰白纸'],
  ['mat_paper_b77fee3e77ebcc5a626958ff', 'PAPER-B77FEE3E77EB', '160g艳闪 / 红卡'],
  ['mat_paper_e194860f33bc816b42930e2a', 'PAPER-E194860F33BC', '160g艳闪 / 闪红 / 红卡'],
] as const;
const canonicalPapers = [
  ['PAPER-ICE-WHITE-160', '160g冰白纸'],
  ['PAPER-RED-CARD-160', '160g红卡'],
  ['PAPER-PEARL-FLASH-160', '160g珠光艳闪'],
  ['PAPER-PEARL-RED-160', '160g珠光闪红'],
] as const;
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
export const repairAction = 'RETIRE_UNUSED_PAPER_IMPORT_20260911';

/** Owns the transaction. Uses the caller's current schema; CLI uses public. */
export async function retireUnusedPaperImports(
  client: Pick<Client, 'query'>,
  { apply = false, confirmDatabase }: { apply?: boolean; confirmDatabase?: string } = {},
) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const { rows: [database] } = await client.query<{ name: string }>('SELECT current_database() AS name');
    if (apply && confirmDatabase !== database?.name) throw new Error('数据库确认不匹配，未执行修复');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [PRICE_RULE_SNAPSHOT_LOCK_KEY]);
    // Prevent concurrent catalog mutations and FK inserts while checking usage.
    await client.query('LOCK TABLE "Material" IN EXCLUSIVE MODE');
    const { rows: materials } = await client.query('SELECT * FROM "Material" ORDER BY id');
    for (const [code, name] of canonicalPapers) {
      const matches = materials.filter((row) => row.code === code);
      if (matches.length !== 1 || matches[0].name !== name || matches[0].category !== 'PAPER' ||
          !matches[0].isActive || matches[0].outOfStock || matches[0].specification !== null) {
        throw new Error(`标准纸张不可用或已改变：${code}`);
      }
    }
    const pending = [];
    for (const [id, code, name] of obsoletePaperImports) {
      const row = materials.find((material) => material.id === id);
      if (!row) {
        // Missing records without this repair's audit are not assumed to be repaired.
        const audit = await client.query('SELECT 1 FROM "BusinessAuditLog" WHERE action = $1 AND "entityId" = $2', [repairAction, id]);
        if (!audit.rowCount) throw new Error(`缺少原记录及修复审计：${code}`);
        continue;
      }
      if (row.code !== code || row.name !== name || row.category !== 'PAPER' ||
          row.specification !== null || row.unit !== '张' || Number(row.currentStock) !== 0 ||
          row.averageCost !== null || row.safetyStock !== null) {
        throw new Error(`导入记录已改变或包含库存/成本：${code}`);
      }
      pending.push(row);
    }
    const ids = pending.map((row) => row.id);
    const retainedFacts = materials
      .filter((row) => row.category === 'PAPER' && !ids.includes(row.id))
      .flatMap((row) => catalogPaperPricingFacts({ name: row.name, specification: row.specification }));
    for (const [, name] of canonicalPapers) {
      const [expected] = catalogPaperPricingFacts({ name, specification: null });
      if (!expected || retainedFacts.filter((fact) => fact.paperType === expected.paperType &&
          fact.paperWeightGsm === expected.paperWeightGsm).length !== 1) {
        throw new Error(`修复后纸张仍不能唯一匹配：${name}`);
      }
    }
    // Inspect real FK consumers, including future tables and ON DELETE SET NULL/CASCADE.
    const { rows: references } = await client.query<{ schema: string; table: string; column: string }>(`
      SELECT ns.nspname AS schema, t.relname AS table, a.attname AS column
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = '"Material"'::regclass
    `);
    for (const ref of references) {
      const used = await client.query(`SELECT 1 FROM ${quote(ref.schema)}.${quote(ref.table)} WHERE ${quote(ref.column)}::text = ANY($1::text[]) LIMIT 1`, [ids]);
      if (used.rowCount) throw new Error(`存在业务引用，拒绝清理：${ref.table}.${ref.column}`);
    }
    // Snapshots have no FK. Preserve immutable history; reject IDs/codes in any JSON column.
    // BusinessAuditLog intentionally retains historical evidence, including our before image.
    const { rows: snapshots } = await client.query<{ table: string; column: string }>(`
      SELECT table_name AS table, column_name AS column FROM information_schema.columns
      WHERE table_schema = current_schema() AND data_type IN ('json', 'jsonb')
        AND table_name <> 'BusinessAuditLog'
    `);
    const patterns = pending.flatMap((row) => [row.id, row.code]).map((value) => `%${value}%`);
    for (const ref of snapshots) {
      const used = await client.query(`SELECT 1 FROM ${quote(ref.table)} WHERE ${quote(ref.column)}::text LIKE ANY($1::text[]) LIMIT 1`, [patterns]);
      if (used.rowCount) throw new Error(`存在历史快照，拒绝清理：${ref.table}.${ref.column}`);
    }
    // Dry run exercises the exact audit/delete statements, then rolls everything back.
    for (const row of pending) {
      await client.query(`INSERT INTO "BusinessAuditLog"
        (id, action, "entityType", "entityId", "before", "after", "requestMetadata")
        VALUES ($1, $2, 'Material', $3, $4::jsonb, $5::jsonb, $6::jsonb)`, [
        randomUUID(), repairAction, row.id, JSON.stringify(row),
        JSON.stringify({ retired: true, canonicalCodes: canonicalPapers.map(([code]) => code) }),
        JSON.stringify({ source: 'scripts/retire-unused-paper-imports.ts', referencesChecked: references.length, snapshotsChecked: snapshots.length }),
      ]);
      const removed = await client.query('DELETE FROM "Material" WHERE id = $1', [row.id]);
      if (removed.rowCount !== 1) throw new Error('资料发生并发改变，已停止');
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { applied: apply, removed: ids, referencesChecked: references.length, snapshotsChecked: snapshots.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
