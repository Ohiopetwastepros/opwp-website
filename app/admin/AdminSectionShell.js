import AdminWorkspace from "./AdminWorkspace";
import { adminGroupFor } from "./admin-navigation.mjs";
import styles from "./routes/routes.module.css";

export default function AdminSectionShell({ section, title, description, email, children }) {
  return <AdminWorkspace section={section} email={email}>
    <main className={styles.workspace} data-admin-content>
      <header className={styles.header}><div><div className={styles.eyebrow}>{adminGroupFor(section)?.label || "Owner workspace"}</div><h1>{title}</h1><p>{description}</p></div></header>
      {children}
    </main>
  </AdminWorkspace>;
}
