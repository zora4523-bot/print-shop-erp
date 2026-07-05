-- PR-9: Pigsty anon / pgaudit readiness for sensitive ERP data.
--
-- This migration deliberately does not run static anonymization and does not
-- enable pgaudit globally. It records the sensitive-column policy and exposes
-- readiness SQL so test/demo masking and DBA audit can be enabled explicitly in
-- a Pigsty-managed PostgreSQL cluster.

CREATE SCHEMA IF NOT EXISTS app_ops;

CREATE TABLE IF NOT EXISTS app_ops.sensitive_column_policy (
  table_schema text NOT NULL DEFAULT 'public',
  table_name text NOT NULL,
  column_name text NOT NULL,
  data_class text NOT NULL,
  masking_strategy text NOT NULL,
  anon_mask_expression text,
  audit_scope text NOT NULL DEFAULT 'WRITE',
  priority integer NOT NULL DEFAULT 100,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sensitive_column_policy_pk PRIMARY KEY (table_schema, table_name, column_name),
  CONSTRAINT sensitive_column_policy_strategy_ck CHECK (
    masking_strategy IN ('anon_security_label', 'manual_export_redact', 'audit_only')
  ),
  CONSTRAINT sensitive_column_policy_audit_scope_ck CHECK (
    audit_scope IN ('NONE', 'WRITE', 'READ_WRITE')
  ),
  CONSTRAINT sensitive_column_policy_anon_expr_ck CHECK (
    masking_strategy <> 'anon_security_label' OR anon_mask_expression IS NOT NULL
  )
);

INSERT INTO app_ops.sensitive_column_policy (
  table_name,
  column_name,
  data_class,
  masking_strategy,
  anon_mask_expression,
  audit_scope,
  priority,
  rationale
)
VALUES
  ('User', 'password', 'secret', 'manual_export_redact', NULL, 'WRITE', 10, 'bcrypt hash must never be exported to demo or support datasets'),
  ('User', 'phone', 'pii', 'anon_security_label', 'anon.partial("phone", 3, $$****$$, 4)', 'READ_WRITE', 20, 'employee contact phone is personal information'),

  ('Order', 'customerRef', 'customer_identifier', 'anon_security_label', 'anon.partial("customerRef", 2, $$****$$, 1)', 'READ_WRITE', 30, 'customer code can identify accounts in support exports'),
  ('Order', 'receiverName', 'pii', 'anon_security_label', 'anon.partial("receiverName", 1, $$**$$, 0)', 'READ_WRITE', 31, 'receiver name is personal information'),
  ('Order', 'receiverPhone', 'pii', 'anon_security_label', 'anon.partial("receiverPhone", 3, $$****$$, 4)', 'READ_WRITE', 32, 'receiver phone is searchable but must be masked outside production'),
  ('Order', 'receiverAddress', 'pii', 'anon_security_label', 'anon.partial("receiverAddress", 6, $$...$$, 0)', 'READ_WRITE', 33, 'delivery address must not appear in demo datasets'),
  ('Order', 'totalAmount', 'finance', 'manual_export_redact', NULL, 'READ_WRITE', 34, 'order amount is finance-of-record data and should be redacted in demos'),

  ('PriceTier', 'unitPrice', 'commercial_secret', 'audit_only', NULL, 'WRITE', 40, 'price table edits should be audited without masking normal owner usage'),
  ('PriceAdjustment', 'amount', 'commercial_secret', 'audit_only', NULL, 'WRITE', 41, 'price adjustment amount edits should be audited'),
  ('PriceAdjustment', 'triggerCondition', 'commercial_secret', 'audit_only', NULL, 'WRITE', 42, 'price adjustment conditions can encode business pricing policy'),

  ('DailyWorkerSalary', 'baseSalary', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 50, 'daily worker base salary is payroll data'),
  ('DailyWorkerSalary', 'totalPieceworkAmount', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 51, 'piecework amount is payroll data'),
  ('DailyWorkerSalary', 'actualSalary', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 52, 'actual daily salary is payroll data'),
  ('SalaryPeriod', 'totalSales', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 53, 'customer-service sales total drives payroll'),
  ('SalaryPeriod', 'initialSales', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 54, 'initial sales value affects payroll settlement'),
  ('SalaryPeriod', 'monthlyBase', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 55, 'monthly base pay is payroll data'),
  ('CustomerServiceCommission', 'totalSales', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 56, 'commission sales total is payroll data'),
  ('CustomerServiceCommission', 'commissionAmount', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 57, 'commission amount is payroll data'),
  ('CustomerServiceCommission', 'monthlyBaseTotal', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 58, 'monthly base total is payroll data'),
  ('CustomerServiceCommission', 'totalIncome', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 59, 'total income is payroll data'),
  ('CustomerServiceCommission', 'paidBase', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 60, 'paid base salary is payroll data'),
  ('CustomerServiceCommission', 'paidCommission', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 61, 'paid commission is payroll data'),
  ('HourlyWorkerPayroll', 'hourlyRate', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 62, 'hourly rate is payroll data'),
  ('HourlyWorkerPayroll', 'baseSalary', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 63, 'hourly worker base salary is payroll data'),
  ('HourlyWorkerPayroll', 'otSalary', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 64, 'overtime salary is payroll data'),
  ('HourlyWorkerPayroll', 'spareSalary', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 65, 'spare-hour salary is payroll data'),
  ('HourlyWorkerPayroll', 'totalSalary', 'payroll', 'manual_export_redact', NULL, 'READ_WRITE', 66, 'monthly total salary is payroll data'),

  ('Bill', 'totalAmount', 'finance', 'manual_export_redact', NULL, 'READ_WRITE', 70, 'bill total is finance-of-record data'),
  ('Bill', 'paidAmount', 'finance', 'manual_export_redact', NULL, 'READ_WRITE', 71, 'bill paid amount is finance-of-record data'),
  ('BillItem', 'orderAmount', 'finance', 'manual_export_redact', NULL, 'READ_WRITE', 72, 'bill item amount is finance-of-record data'),

  ('NotificationChannel', 'webhookUrl', 'secret', 'anon_security_label', 'anon.partial("webhookUrl", 24, $$...$$, 8)', 'WRITE', 80, 'enterprise WeChat webhook URL is a secret'),
  ('NotificationLog', 'messageContent', 'message_body', 'manual_export_redact', NULL, 'WRITE', 81, 'notification body may contain order/customer details'),
  ('NotificationLog', 'errorMessage', 'message_body', 'manual_export_redact', NULL, 'WRITE', 82, 'error text should avoid leaking webhook or payload details')
ON CONFLICT (table_schema, table_name, column_name) DO UPDATE
SET
  data_class = EXCLUDED.data_class,
  masking_strategy = EXCLUDED.masking_strategy,
  anon_mask_expression = EXCLUDED.anon_mask_expression,
  audit_scope = EXCLUDED.audit_scope,
  priority = EXCLUDED.priority,
  rationale = EXCLUDED.rationale,
  updated_at = now();

CREATE OR REPLACE VIEW app_ops.sensitive_column_readiness AS
SELECT
  p.table_schema,
  p.table_name,
  p.column_name,
  p.data_class,
  p.masking_strategy,
  p.anon_mask_expression,
  p.audit_scope,
  p.priority,
  p.rationale,
  (a.attnum IS NOT NULL) AS column_exists,
  sl.label AS current_anon_label,
  (sl.label IS NOT NULL) AS anon_label_applied,
  CASE
    WHEN p.masking_strategy = 'anon_security_label' AND p.anon_mask_expression IS NOT NULL THEN
      format(
        'SECURITY LABEL FOR anon ON COLUMN %I.%I.%I IS %L;',
        p.table_schema,
        p.table_name,
        p.column_name,
        'MASKED WITH FUNCTION ' || p.anon_mask_expression
      )
    ELSE NULL
  END AS apply_anon_label_sql,
  CASE
    WHEN p.masking_strategy = 'manual_export_redact' THEN
      'Redact or replace this column in export/runbook SQL before loading test or demo data.'
    WHEN p.masking_strategy = 'audit_only' THEN
      'Do not mask normal owner workflow; audit direct database writes through pgaudit.'
    ELSE
      'Apply the generated anon SECURITY LABEL in a masked test/demo role setup.'
  END AS handling_note
FROM app_ops.sensitive_column_policy p
LEFT JOIN pg_namespace n
  ON n.nspname = p.table_schema
LEFT JOIN pg_class c
  ON c.relnamespace = n.oid
 AND c.relname = p.table_name
LEFT JOIN pg_attribute a
  ON a.attrelid = c.oid
 AND a.attname = p.column_name
 AND NOT a.attisdropped
LEFT JOIN pg_seclabel sl
  ON sl.objoid = c.oid
 AND sl.objsubid = a.attnum
 AND sl.provider = 'anon';

CREATE OR REPLACE VIEW app_ops.security_audit_table_readiness AS
SELECT
  r.table_schema,
  r.table_name,
  bool_or(r.audit_scope = 'READ_WRITE') AS audit_reads,
  bool_or(r.audit_scope IN ('WRITE', 'READ_WRITE')) AS audit_writes,
  bool_and(r.column_exists) AS all_columns_exist,
  array_agg(r.column_name ORDER BY r.priority, r.column_name) AS sensitive_columns,
  CASE
    WHEN bool_or(r.audit_scope = 'READ_WRITE') THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
    ELSE ARRAY['INSERT', 'UPDATE', 'DELETE']::text[]
  END AS audit_operations,
  format(
    'GRANT %s ON TABLE %I.%I TO erp_auditor;',
    CASE
      WHEN bool_or(r.audit_scope = 'READ_WRITE') THEN 'SELECT, INSERT, UPDATE, DELETE'
      ELSE 'INSERT, UPDATE, DELETE'
    END,
    r.table_schema,
    r.table_name
  ) AS audit_grant_sql
FROM app_ops.sensitive_column_readiness r
WHERE r.audit_scope <> 'NONE'
GROUP BY r.table_schema, r.table_name;

CREATE OR REPLACE VIEW app_ops.security_extension_readiness AS
WITH ext AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_available_extensions WHERE name = 'anon'
    ) AS anon_available,
    EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'anon'
    ) AS anon_installed,
    (
      'anon' = ANY(regexp_split_to_array(coalesce(current_setting('shared_preload_libraries', true), ''), '\s*,\s*'))
      OR 'anon' = ANY(regexp_split_to_array(coalesce(current_setting('session_preload_libraries', true), ''), '\s*,\s*'))
    ) AS anon_preloaded,
    EXISTS (
      SELECT 1 FROM pg_available_extensions WHERE name = 'pgaudit'
    ) AS pgaudit_available,
    EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pgaudit'
    ) AS pgaudit_installed,
    'pgaudit' = ANY(regexp_split_to_array(coalesce(current_setting('shared_preload_libraries', true), ''), '\s*,\s*')) AS pgaudit_preloaded
),
counts AS (
  SELECT
    count(*)::integer AS policy_count,
    count(*) FILTER (WHERE masking_strategy = 'anon_security_label')::integer AS anon_label_policy_count,
    count(*) FILTER (WHERE masking_strategy = 'manual_export_redact')::integer AS manual_redact_policy_count,
    count(*) FILTER (WHERE masking_strategy = 'audit_only')::integer AS audit_only_policy_count,
    count(*) FILTER (WHERE NOT column_exists)::integer AS missing_column_count,
    count(*) FILTER (WHERE masking_strategy = 'anon_security_label' AND anon_label_applied)::integer AS anon_label_applied_count
  FROM app_ops.sensitive_column_readiness
),
audit_counts AS (
  SELECT count(*)::integer AS audit_table_count
  FROM app_ops.security_audit_table_readiness
)
SELECT
  ext.anon_available,
  ext.anon_installed,
  ext.anon_preloaded,
  ext.pgaudit_available,
  ext.pgaudit_installed,
  ext.pgaudit_preloaded,
  counts.policy_count,
  counts.anon_label_policy_count,
  counts.anon_label_applied_count,
  counts.manual_redact_policy_count,
  counts.audit_only_policy_count,
  counts.missing_column_count,
  audit_counts.audit_table_count,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN counts.anon_label_policy_count > 0 AND NOT ext.anon_available THEN 'anon_not_available' END,
    CASE WHEN counts.anon_label_policy_count > 0 AND NOT ext.anon_installed THEN 'anon_not_installed' END,
    CASE WHEN counts.anon_label_policy_count > 0 AND NOT ext.anon_preloaded THEN 'anon_not_preloaded_for_dynamic_masking' END,
    CASE WHEN NOT ext.pgaudit_available THEN 'pgaudit_not_available' END,
    CASE WHEN NOT ext.pgaudit_preloaded THEN 'pgaudit_not_preloaded' END,
    CASE WHEN NOT ext.pgaudit_installed THEN 'pgaudit_not_installed' END,
    CASE WHEN counts.missing_column_count > 0 THEN 'sensitive_policy_references_missing_columns' END
  ], NULL)::text[] AS blockers,
  ARRAY[
    'Pigsty cluster config: add anon to shared_preload_libraries, or set session_preload_libraries for the masked database before using dynamic masking.',
    'CREATE EXTENSION IF NOT EXISTS anon CASCADE;',
    'SELECT anon.init();',
    format('ALTER DATABASE %I SET session_preload_libraries = %L;', current_database(), 'anon'),
    format('ALTER DATABASE %I SET anon.transparent_dynamic_masking TO %L;', current_database(), 'true'),
    'CREATE ROLE erp_masked_export LOGIN;',
    'SECURITY LABEL FOR anon ON ROLE erp_masked_export IS ''MASKED'';'
  ]::text[] AS recommended_anon_steps,
  ARRAY[
    'Pigsty cluster config: add pgaudit to shared_preload_libraries and restart PostgreSQL before creating the extension.',
    'CREATE EXTENSION IF NOT EXISTS pgaudit;',
    'CREATE ROLE erp_auditor;',
    'ALTER SYSTEM SET pgaudit.log = ''write, ddl, role'';',
    'ALTER SYSTEM SET pgaudit.log_parameter = ''off'';',
    'ALTER SYSTEM SET pgaudit.log_relation = ''on'';',
    'ALTER SYSTEM SET pgaudit.role = ''erp_auditor'';'
  ]::text[] AS recommended_pgaudit_steps
FROM ext
CROSS JOIN counts
CROSS JOIN audit_counts;
