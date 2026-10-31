export async function persistReconciliation(db, cases, summary, now) {
  const payload=JSON.stringify(cases);
  if(cases.length>2100 || new TextEncoder().encode(payload).length>1500000) throw new Error('Reconciliation storage budget exceeded.');
  // Set-based statements bound D1 query usage. Audit, cases and run commit atomically.
  // Missing/windowed-out cases never silently resolve.
  await db.batch([
    db.prepare(`INSERT INTO financial_reconciliation_audit(at,actor,action,detail)
      SELECT ?,'scheduler','case_changed',value FROM json_each(?) AS incoming
      WHERE NOT EXISTS (SELECT 1 FROM financial_reconciliation_cases AS prior
        WHERE prior.id=json_extract(incoming.value,'$.id')
          AND prior.status=json_extract(incoming.value,'$.status')
          AND prior.evidence=json_extract(incoming.value,'$.evidence'))`).bind(now,payload),
    db.prepare(`INSERT INTO financial_reconciliation_cases(id,kind,status,evidence,first_seen_at,last_seen_at,resolved_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.kind'),json_extract(value,'$.status'),
        json_extract(value,'$.evidence'),?,?,CASE WHEN json_extract(value,'$.status')='resolved' THEN ? ELSE NULL END
      FROM json_each(?) WHERE 1
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,evidence=excluded.evidence,last_seen_at=excluded.last_seen_at,
        resolved_at=CASE WHEN excluded.status='resolved' THEN COALESCE(financial_reconciliation_cases.resolved_at,excluded.resolved_at) ELSE NULL END`).bind(now,now,now,payload),
    db.prepare('INSERT INTO financial_reconciliation_runs(id,checked_at,status,summary) VALUES (?,?,?,?)').bind(crypto.randomUUID(),now,summary.status,JSON.stringify(summary)),
  ]);
}
