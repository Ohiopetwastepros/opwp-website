import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { stripeConfigured } from "@/lib/stripe";
import SignOutButton from "../route-partner/SignOutButton";
import DogFoodOperationsClient from "./DogFoodOperationsClient";
import styles from "./dog-food.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dog Food Operations | OPWP", robots: { index: false, follow: false, nocache: true } };

async function dashboard(db) {
  const [summary, orders, subscriptions, products, customers, orderItems] = await Promise.all([
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM dog_food_customers WHERE status='active') AS active_customers,
      (SELECT COUNT(*) FROM dog_food_orders WHERE status IN ('pending_payment','payment_failed')) AS unpaid_orders,
      (SELECT COALESCE(SUM(total_cents),0) FROM dog_food_orders WHERE status IN ('pending_payment','payment_failed')) AS unpaid_cents,
      (SELECT COUNT(*) FROM dog_food_subscriptions WHERE status='active') AS active_subscriptions,
      (SELECT COUNT(*) FROM dog_food_deliveries WHERE scheduled_date=date('now') AND status IN ('scheduled','assigned','out_for_delivery')) AS due_today,
      (SELECT COALESCE(SUM(total_cents),0) FROM dog_food_orders WHERE status IN ('paid','scheduled','fulfilled') AND created_at>=datetime('now','-30 days')) AS revenue_30_cents`).first(),
    db.prepare(`SELECT o.id,o.order_number,o.order_type,o.status,o.subtotal_cents,o.delivery_fee_cents,o.tax_cents,o.total_cents,o.requested_delivery_speed,o.created_at,
      (SELECT provider FROM dog_food_payments pay WHERE pay.order_id=o.id ORDER BY pay.created_at DESC LIMIT 1) AS payment_provider,
      c.first_name,c.last_name,c.customer_type,c.sng_client_id,d.id AS delivery_id,d.scheduled_date,d.status AS delivery_status,d.delivered_at,d.placement_note,
      GROUP_CONCAT(CAST(oi.quantity AS TEXT)||'× '||p.formula_code||' '||p.color||' '||CAST(p.bag_weight_lb AS TEXT)||' lb',', ') AS items
      FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id
      LEFT JOIN dog_food_deliveries d ON d.order_id=o.id LEFT JOIN dog_food_order_items oi ON oi.order_id=o.id LEFT JOIN dog_food_products p ON p.id=oi.product_id
      GROUP BY o.id ORDER BY o.created_at DESC LIMIT 75`).all(),
    db.prepare(`SELECT s.id,s.status,s.frequency_weeks,s.billing_interval_months,s.payment_provider,s.next_charge_at,s.next_delivery_date,s.card_brand,s.card_last_four,c.first_name,c.last_name,
      GROUP_CONCAT(CAST(si.quantity AS TEXT)||'× '||p.formula_code||' '||p.color||' '||CAST(p.bag_weight_lb AS TEXT)||' lb',', ') AS items
      FROM dog_food_subscriptions s JOIN dog_food_customers c ON c.id=s.customer_id
      LEFT JOIN dog_food_subscription_items si ON si.subscription_id=s.id AND si.is_active=1 LEFT JOIN dog_food_products p ON p.id=si.product_id
      GROUP BY s.id ORDER BY s.next_delivery_date LIMIT 50`).all(),
    db.prepare(`SELECT p.id,p.formula_code,p.color,p.name,p.bag_weight_lb,p.retail_price_cents,p.reorder_point,p.is_active,
      COALESCE(SUM(m.quantity_delta),0) AS quantity_on_hand
      FROM dog_food_products p LEFT JOIN dog_food_inventory_movements m ON m.product_id=p.id
      GROUP BY p.id ORDER BY p.bag_weight_lb DESC,p.formula_code`).all(),
    db.prepare(`SELECT c.id,c.first_name,c.last_name,c.email,c.phone,c.customer_type,c.sng_client_id,c.stripe_customer_id,c.card_brand,c.card_last_four,a.city,a.postal_code,a.route_day
      FROM dog_food_customers c LEFT JOIN dog_food_addresses a ON a.customer_id=c.id AND a.is_primary=1
      WHERE c.status='active' ORDER BY c.last_name,c.first_name LIMIT 250`).all(),
    db.prepare(`SELECT oi.order_id,oi.product_id,oi.quantity FROM dog_food_order_items oi
      JOIN (SELECT id FROM dog_food_orders ORDER BY created_at DESC LIMIT 75) recent ON recent.id=oi.order_id
      ORDER BY oi.created_at`).all(),
  ]);
  const itemsByOrder = new Map();
  for (const item of orderItems.results || []) {
    const current = itemsByOrder.get(item.order_id) || [];
    current.push({ productId: item.product_id, quantity: Number(item.quantity) || 0 });
    itemsByOrder.set(item.order_id, current);
  }
  return {
    summary: summary || {},
    orders: (orders.results || []).map((order) => ({ ...order, lineItems: itemsByOrder.get(order.id) || [] })),
    subscriptions: subscriptions.results || [], products: products.results || [], customers: customers.results || [],
  };
}

export default async function DogFoodOperationsPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/dog-food/");
  const db = getDb();
  const data = db ? await dashboard(db) : { summary: {}, orders: [], subscriptions: [], products: [], customers: [] };
  data.stripeConfigured = stripeConfigured();
  return <main className={`opwp-admin-shell ${styles.shell}`}>
    <aside className={styles.rail}>
      <a className={styles.brand} href="/admin/"><span>O</span><div><strong>OPWP</strong><small>Operating system</small></div></a>
      <nav aria-label="Operations navigation">
        <a href="/admin/">Executive overview</a><a href="/admin/routes/">Route intelligence</a><a href="/admin/route-partner/">Route Partner</a><a href="/admin/route-partner/team/">Field team</a><a className={styles.active} href="/admin/dog-food/">Extreme Dog Fuel</a>
      </nav>
      <div className={styles.railFoot}><span />Standalone commerce</div>
    </aside>
    <section className={styles.workspace}>
      <header className={styles.header}><div><span className={styles.eyebrow}>OPWP × Extreme Dog Fuel</span><h1>Dog-food operations</h1><p>One place to control customers, orders, billing status, subscriptions, delivery, and inventory.</p></div><div className={styles.identity}><span>Signed in as</span><strong>{auth.email}</strong><SignOutButton /></div></header>
      <DogFoodOperationsClient initialData={data} />
    </section>
  </main>;
}
