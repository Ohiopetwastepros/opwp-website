import AdminWorkspace from "../AdminWorkspace";
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { listMfaDevices } from '@/lib/admin-mfa.mjs';
import LoginForm from '../login/LoginForm';
import styles from '../login/login.module.css';
export const dynamic='force-dynamic';
export const metadata={title:'Device security | Ohio Pet Waste Pros',robots:{index:false,follow:false}};
export default async function SecurityPage(){
 const auth=await verifyAdminRequest(await headers());if(!auth.authorized)redirect('/admin/login/?next=%2Fadmin%2Fsecurity%2F');
 const devices=await listMfaDevices(getRuntimeEnv());
 return <AdminWorkspace section="security" email={auth.email}><main className={styles.securityPage}><a href="/admin/">← Back to workspace</a><h1>Authenticator and trusted devices</h1><p>Trusted browsers expire 30 days after verification. Activity does not extend the deadline. Signing out removes trust for that browser.</p><section><h2>Active browser sessions</h2><ul>{devices.map((device,index)=><li key={index}><strong>{device.trusted?'Trusted browser':'12-hour session'}</strong><p>{device.device_label}</p><p>Expires {new Date(device.expires_at*1000).toLocaleString('en-US',{timeZone:'America/New_York'})} Eastern</p></li>)}</ul></section><LoginForm security username={auth.email} next="/admin/security/"/></main></AdminWorkspace>;
}
