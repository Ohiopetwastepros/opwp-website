import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { readMarketingSnapshot } from '@/lib/marketing-store.mjs';
import { readBusinessAcquisition, OPPORTUNITY_STAGES } from '@/lib/business-acquisition.mjs';
import seed from '@/data/meta-ads-audit-2026-10-06.json';
import { readLiveDensity,readDensityReviews } from '@/lib/live-density-store.mjs';
import { FALL_CREATIVE_BRIEFS } from '@/data/fall-meta-creative-briefs.mjs';
import AdminSectionShell from '../AdminSectionShell';
import AcquisitionClient from './AcquisitionClient';
export const dynamic='force-dynamic';
export const metadata={title:'Acquisition | OPWP',robots:{index:false,follow:false,nocache:true}};
export default async function AcquisitionPage({searchParams}) {
  const auth=await verifyAdminRequest(await headers());
  if(!auth.authorized) redirect('/admin/login/?next=/admin/acquisition/');
  const params=await searchParams;
  let marketing={revision:'',daily:[],outcomes:[]},businesses={revision:'',opportunities:[],updatedAt:null},marketingAvailable=true,businessAvailable=true;
  try {marketing=await readMarketingSnapshot(getDb());} catch {marketingAvailable=false;}
  try {businesses=await readBusinessAcquisition(getDb());} catch {businessAvailable=false;}
  let density=null,densityReviews={revision:'',reviews:[]};
  try {density=await readLiveDensity(getDb());densityReviews=await readDensityReviews(getDb());} catch { /* The live tab can retry without inventing client locations. */ }
  return <AdminSectionShell section="acquisition" title="Acquisition" description="Grow the customer book through advertising, denser routes and future business acquisitions." email={auth.email}>
    <AcquisitionClient seed={seed} density={density} densityReviews={densityReviews} briefs={FALL_CREATIVE_BRIEFS} marketing={marketing} businesses={businesses} stages={OPPORTUNITY_STAGES} marketingAvailable={marketingAvailable} businessAvailable={businessAvailable} initialTab={params?.tab}/>
  </AdminSectionShell>;
}
