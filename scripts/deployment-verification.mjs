export async function verifyLiveRelease(id, fetcher = fetch, { attempts = 6, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const origin = 'https://www.ohiopetwastepros.com';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(`${origin}/api/release-status/`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const text = await response.text();
      if (!response.ok || text.length > 2048 || JSON.parse(text).id !== id) throw new Error('Expected release is not live yet');
      const home = await fetcher(origin + '/', { redirect: 'manual', signal: AbortSignal.timeout(15_000) }); await home.body?.cancel();
      if (home.status !== 200) throw new Error('Homepage health check failed');
      const admin = await fetcher(origin + '/admin/deployments/', { redirect: 'manual', signal: AbortSignal.timeout(15_000) }); await admin.body?.cancel();
      if (![302, 307].includes(admin.status) || !admin.headers.get('location')?.startsWith('/admin/login/')) throw new Error('Admin protection check failed');
      return { checkedAt: new Date().toISOString(), releaseMatched: true, homepage: 200, adminProtected: true };
    } catch { if (attempt === attempts - 1) throw new Error('Live verification failed: expected release, homepage health, or admin protection did not pass.'); }
    await pause(10_000);
  }
}
