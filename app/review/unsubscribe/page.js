export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unsubscribe from review emails | Ohio Pet Waste Pros', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function UnsubscribePage({ searchParams }) {
  const params = await searchParams;
  const token = typeof params.token === 'string' && /^[a-f0-9-]{72}$/.test(params.token) ? params.token : '';
  return <main style={{ maxWidth: 620, margin: '4rem auto', padding: '2rem' }}>
    <h1>Review email preferences</h1>
    <p>You can stop future Google review request emails from Ohio Pet Waste Pros.</p>
    {token ? <form action="/api/review-requests/unsubscribe/" method="post">
      <input type="hidden" name="token" value={token} />
      <button type="submit" style={{ padding: '1rem 2rem', cursor: 'pointer' }}>Unsubscribe from review emails</button>
    </form> : <p>Open the unsubscribe link in your review email to update your preference.</p>}
  </main>;
}
