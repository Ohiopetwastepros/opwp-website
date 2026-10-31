import AdminWorkspace from "../../AdminWorkspace";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import ConversationPreview from "./ConversationPreview";
import styles from "../growth-desk.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facebook conversation preview | YardOps", robots: { index: false, follow: false, nocache: true } };

export default async function MetaPreviewPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/quote-funnel/meta-preview/");
  return <AdminWorkspace section="pipeline" email={auth.email}><main className={`${styles.workspace} opwp-admin-shell`}><div className={styles.wrap}>
    <nav className={styles.topLinks}><Link href="/admin/quote-funnel/">← YardOps Pipeline</Link></nav>
    <header className={styles.header}><div><div className={styles.eyebrow}>OPWP lead operations</div><h1 className={styles.title}>Review the Facebook text flow</h1><p className={styles.subtitle}>Try sample replies, cleanup estimates and custom-quote branches before automatic texting is enabled.</p></div></header>
    <ConversationPreview />
  </div></main></AdminWorkspace>;
}
