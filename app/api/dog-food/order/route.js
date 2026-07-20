import { cancelDogFoodFollowUp, getDb, saveSubmission } from "@/lib/db";

export const runtime = "nodejs";

function validText(value, max = 200) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function sameDayOrderingOpen() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value || 24) < 12;
}

const productIdByFormula = {
  "22-12": "edf-22-12-pink-40",
  "26-14": "edf-26-14-blue-40",
  "26-18": "edf-26-18-green-40",
  "30-20": "edf-30-20-red-40",
};

async function createCommerceOrder(body, submissionId) {
  const db = getDb();
  if (!db) return null;
  const customer = body.customer;
  const email = customer.email.trim().toLowerCase();
  const requested = Array.isArray(body.orderLines) ? body.orderLines : [];
  if (!requested.length || requested.length > 4) throw new Error("Your recommendation did not include a valid bag selection.");

  const quantities = new Map();
  for (const line of requested) {
    const productId = productIdByFormula[String(line?.formula?.code || "")];
    const quantity = Number(line?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error("Your bag selection could not be verified.");
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  if ([...quantities.values()].some((quantity) => quantity > 10)) throw new Error("A single formula cannot exceed ten bags per order.");
  const productIds = [...quantities.keys()];
  const placeholders = productIds.map(() => "?").join(",");
  const products = await db.prepare(
    `SELECT id,retail_price_cents FROM dog_food_products
     WHERE id IN (${placeholders}) AND is_active=1 AND is_customer_visible=1 AND retail_price_cents IS NOT NULL`
  ).bind(...productIds).all();
  if ((products.results || []).length !== productIds.length) throw new Error("One or more recommended bags are not currently available.");

  const subtotal = (products.results || []).reduce((sum, product) => sum + Number(product.retail_price_cents) * quantities.get(product.id), 0);
  const deliveryFee = body.delivery === "same_day" ? 1000 : body.delivery === "next_day" ? 500 : 0;
  const foodTax = (products.results || []).reduce((sum, product) => sum + Math.round(Number(product.retail_price_cents) * 0.0775) * quantities.get(product.id), 0);
  const tax = foodTax + Math.round(deliveryFee * 0.0775);
  const customerRecord = await db.prepare("SELECT id FROM dog_food_customers WHERE lower(email)=? LIMIT 1").bind(email).first();
  const customerId = customerRecord?.id || crypto.randomUUID();
  const addressRecord = customerRecord
    ? await db.prepare("SELECT id FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY updated_at DESC LIMIT 1").bind(customerId).first()
    : null;
  const addressId = addressRecord?.id || crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const orderNumber = `EDF-${orderId.slice(0, 8).toUpperCase()}`;
  const placement = customer.placement === "Other" ? customer.placementOther.trim() : customer.placement;
  const statements = [];

  if (customerRecord) {
    statements.push(db.prepare(
      `UPDATE dog_food_customers SET first_name=?,last_name=?,phone=?,customer_type=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(customer.firstName.trim(), customer.lastName.trim(), customer.phone.trim(), customer.customerType, customerId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO dog_food_customers (id,first_name,last_name,email,phone,customer_type)
       VALUES (?,?,?,?,?,?)`
    ).bind(customerId, customer.firstName.trim(), customer.lastName.trim(), email, customer.phone.trim(), customer.customerType));
  }
  if (addressRecord) {
    statements.push(db.prepare(
      `UPDATE dog_food_addresses SET line1=?,city=?,state=?,postal_code=?,placement_preference=?,placement_other=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(customer.address.trim(), customer.city.trim(), customer.state || "OH", customer.zip, customer.placement, customer.placementOther?.trim() || null, addressId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO dog_food_addresses (id,customer_id,line1,city,state,postal_code,placement_preference,placement_other,is_primary)
       VALUES (?,?,?,?,?,?,?,?,1)`
    ).bind(addressId, customerId, customer.address.trim(), customer.city.trim(), customer.state || "OH", customer.zip, customer.placement, customer.placementOther?.trim() || null));
  }
  statements.push(db.prepare(
    `INSERT INTO dog_food_orders
      (id,order_number,customer_id,address_id,order_type,status,subtotal_cents,delivery_fee_cents,tax_rate_basis_points,tax_cents,total_cents,requested_delivery_speed,source,notes,placed_at)
     VALUES (?,?,?,?,?,'pending_payment',?,?,775,?,?,?,'website',?,CURRENT_TIMESTAMP)`
  ).bind(orderId, orderNumber, customerId, addressId, body.plan, subtotal, deliveryFee, tax, subtotal + deliveryFee + tax, body.delivery,
    `Website request ${submissionId}. Delivery date and payment must be confirmed before route release. Placement: ${placement}`));
  for (const product of products.results || []) {
    const quantity = quantities.get(product.id);
    statements.push(db.prepare(
      `INSERT INTO dog_food_order_items (id,order_id,product_id,quantity,unit_price_cents,line_total_cents,substitution_policy)
       VALUES (?,?,?,?,?,?,'same_formula_weight')`
    ).bind(crypto.randomUUID(), orderId, product.id, quantity, product.retail_price_cents, Number(product.retail_price_cents) * quantity));
  }
  await db.batch(statements);
  return { orderId, orderNumber, totalCents: subtotal + deliveryFee + tax };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const customer = body?.customer ?? {};
    const dogs = Array.isArray(body?.dogs) ? body.dogs : [];

    const phoneDigits = String(customer.phone || "").replace(/\D/g, "");
    if (!customer.consent || !validText(customer.firstName, 80) || !validText(customer.lastName, 80) ||
        !validText(customer.email, 200) || !customer.email.includes("@") ||
        !validText(customer.phone, 40) || phoneDigits.length < 10 || !validText(customer.address, 200) ||
        !validText(customer.city, 100) || !/^\d{5}$/.test(customer.zip ?? "")) {
      return Response.json({ error: "Please complete all required customer and delivery fields." }, { status: 400 });
    }
    if (!["scoop", "route_partner", "on_demand"].includes(customer.customerType) || !["subscription", "on_demand"].includes(body?.plan) || !["route_day", "next_day", "same_day"].includes(body?.delivery)) {
      return Response.json({ error: "Choose a valid customer, order, and delivery type." }, { status: 400 });
    }
    if (body.plan === "subscription" && body.delivery !== "route_day") {
      return Response.json({ error: "Monthly delivery must use the free recurring route day." }, { status: 400 });
    }
    if (body.delivery === "same_day" && !sameDayOrderingOpen()) {
      return Response.json({ error: "Same-day ordering closes at 12:00 PM Eastern. Choose next-day or a free route day." }, { status: 400 });
    }
    if (customer.placement === "Other" && !validText(customer.placementOther, 200)) {
      return Response.json({ error: "Tell us where the food should be placed." }, { status: 400 });
    }

    const earlierDogIds = new Set();
    const invalidDogs = dogs.some((dog, index) => {
      const copiesEarlierDog = index > 0 && dog?.matchMode === "same_food" &&
        earlierDogIds.has(Number(dog?.sameAsDogId));
      const hasQuestionnaire = dog?.matchMode === "individual" &&
        dog.lifeStage && dog.breedSize && dog.activity && dog.metabolism &&
        dog.bodyCondition && dog.goal && Array.isArray(dog.jointNeeds) &&
        dog.jointNeeds.length > 0 && dog.digestion && dog.skinCoat && dog.priority;
      earlierDogIds.add(dog?.id);
      return !copiesEarlierDog && !hasQuestionnaire;
    });

    if (dogs.length < 1 || dogs.length > 10 || invalidDogs) {
      return Response.json({ error: "Please complete the questionnaire for one to ten dogs." }, { status: 400 });
    }

    const stored = await saveSubmission({
      kind: "dog_food_order_request",
      source: "dog_food_tool",
      status: "awaiting_payment_setup",
      body: {
        ...body,
        first_name: customer.firstName.trim(),
        last_name: customer.lastName.trim(),
        email: customer.email.trim(),
        phone: customer.phone.trim(),
        zip: customer.zip,
      },
    });

    const commerceOrder = await createCommerceOrder(body, stored.id);

    if (body.partialSubmissionId) {
      await cancelDogFoodFollowUp(body.partialSubmissionId);
    }

    return Response.json({
      ok: true,
      orderNumber: commerceOrder?.orderNumber || `EDF-${stored.id.slice(0, 8).toUpperCase()}`,
      stored: stored.configured,
    });
  } catch {
    return Response.json({ error: "We could not submit the order. Please try again." }, { status: 500 });
  }
}
