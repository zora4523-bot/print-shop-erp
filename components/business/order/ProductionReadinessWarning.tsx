export function ProductionReadinessWarning({ readiness, saved = false, title }: {
  readiness?: { ready: boolean; issues: string[] }; saved?: boolean; title?: string;
}) {
  if (!readiness || readiness.ready || readiness.issues.length === 0) return null;
  return <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
    <p>{title ?? (saved ? '费用已确认，工单仍需补录以下资料才能进入待下发：' : '确认费用后，工单仍需补录以下资料才能进入待下发：')}</p>
    <ul className="list-disc pl-5">{readiness.issues.map((issue, index) => <li key={index}>{issue.replace('可唯一映射的 canonical 工艺', '工艺')}</li>)}</ul>
  </div>;
}
