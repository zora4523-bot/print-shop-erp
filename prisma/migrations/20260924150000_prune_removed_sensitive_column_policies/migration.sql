-- 20260924100000_remove_cleaner_cook_cleaning 删除了 HourlyWorkerPayroll.spareSalary，
-- 20260924110000_remove_customer_service_role 删除了 SalaryPeriod /
-- CustomerServiceCommission 两张客服工资表，但 app_ops.sensitive_column_policy
-- 按字符串登记的脱敏策略不会随删列 / 删表级联清理。遗留的 10 条策略让
-- app_ops.security_extension_readiness 一直报
-- sensitive_policy_references_missing_columns，/owner/pigsty 的脱敏就绪永远为
-- false，还会展示针对不存在表的授权 SQL。
--
-- 本迁移只删除这 10 条策略，并且只在对应列确实已不存在时删除（重复执行或
-- 列仍存在时不改任何行）。不写显式 BEGIN / COMMIT：单条语句本身即原子。

DELETE FROM app_ops.sensitive_column_policy AS p
WHERE (p.table_schema, p.table_name, p.column_name) IN (
    ('public', 'HourlyWorkerPayroll', 'spareSalary'),
    ('public', 'SalaryPeriod', 'totalSales'),
    ('public', 'SalaryPeriod', 'initialSales'),
    ('public', 'SalaryPeriod', 'monthlyBase'),
    ('public', 'CustomerServiceCommission', 'totalSales'),
    ('public', 'CustomerServiceCommission', 'commissionAmount'),
    ('public', 'CustomerServiceCommission', 'monthlyBaseTotal'),
    ('public', 'CustomerServiceCommission', 'totalIncome'),
    ('public', 'CustomerServiceCommission', 'paidBase'),
    ('public', 'CustomerServiceCommission', 'paidCommission')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = p.table_schema
      AND c.table_name = p.table_name
      AND c.column_name = p.column_name
  );
