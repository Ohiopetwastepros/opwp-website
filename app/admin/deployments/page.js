import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import release from '@/lib/deployment-release.json';
import { controllerHealth } from '@/lib/deployment-policy.mjs';
import AutoRefresh from './AutoRefresh';
import AdminSectionShell from '../AdminSectionShell';
import styles from '../admin-navigation.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deployments | OPWP', robots: { index: false, follow: false } };
export default async function DeploymentsPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect('/');
  const env = getRuntimeEnv();
  let runs = [], controller = null, unavailable = false;
  try {
    if (!env.DB) throw new Error('Unavailable');
    const rows = await env.DB.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'deployment_run:%' ORDER BY updated_at DESC LIMIT 30").all();
    runs = rows.results.map(row => JSON.parse(row.payload));
    const control = await env.DB.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key = 'deployment_controller_v1'").first();
    controller = control ? JSON.parse(control.payload) : null;
  } catch { unavailable = true; }
  const pending = runs.filter(run => !['verified', 'superseded'].includes(run.status));
  return <AdminSectionShell section="deployments" title="Deployments" description="See what is live and what still needs to be released." email={auth.email}>
    <AutoRefresh />
    <section className={styles.notice}><strong>Automatic recovery: {controllerHealth(controller, Date.now(), { failureTriggered: true })}</strong><p>{controller?.reason || 'Recovery is standing by until a deployment records a failure.'}</p><p>Last recovery event: {controller?.checkedAt || 'None recorded'}. Recovery starts only after a failed deployment; this view refreshes every 30 seconds.</p><p>Retries are bounded to three total attempts; unresolved code or configuration failures remain flagged.</p></section>
    <section className={styles.notice}><strong>Live release</strong><p>{release.summary}</p><p>Release: {release.id}<br />Cloudflare version: {env.CF_VERSION_METADATA?.id || 'Unavailable'}<br />Version created: {env.CF_VERSION_METADATA?.timestamp || 'Unavailable'}</p><p>Source fingerprint: {release.sourceHash || 'Not recorded'}</p><a href="/admin/deployments/">Refresh deployment status</a></section>
    <section className={styles.notice}><strong>{unavailable ? 'Deployment history unavailable' : `${pending.length} recorded release(s) awaiting resolution`}</strong><p>Work in progress waits for its owning session. Ready releases are recovered automatically. Unreported local edits and other projects are not monitored.</p></section>
    {runs.map(run => <section className={styles.notice} key={run.id}><strong>{run.status === 'verified' && run.id === release.id ? 'Verified live' : run.status?.replaceAll('_', ' ')} — {run.summary}</strong><p>{run.updatedAt} · {run.stage}</p><p>Attempts: {run.attempts || 0} of 3. {run.nextRetryAt && `Next automatic retry: ${run.nextRetryAt}`}</p>{run.lastAction && <p>{run.lastAction}</p>}{run.reason && <p>{run.reason}</p>}{run.verifiedAt && <p>Live checks passed: {run.verifiedAt}</p>}<details><summary>Release details</summary><p>{run.id}<br />Commit: {run.commit}<br />Source: {run.sourceHash}{run.resolvedBy && <><br />Resolved by: {run.resolvedBy}</>}</p></details></section>)}
  </AdminSectionShell>;
}
