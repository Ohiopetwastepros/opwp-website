import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { foodAccountSession } from '@/lib/dog-food-account.mjs';
import SubscriptionPortal from './SubscriptionPortal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your subscription history | Ohio Pet Waste Pros', robots: { index: false, follow: false } };
export default async function Page() {
  const account = await foodAccountSession(getDb(), await headers());
  if (!account) redirect('/dog-food/account/');
  return <SubscriptionPortal />;
}
