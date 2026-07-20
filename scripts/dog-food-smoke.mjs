const base = process.env.DOG_FOOD_SMOKE_BASE || "http://127.0.0.1:8787";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const payload = {
  customer: {
    firstName: "Order",
    lastName: "QA",
    email: "dog-food-qa@example.invalid",
    phone: "419-555-0100",
    address: "123 Test Lane",
    city: "Holland",
    state: "OH",
    zip: "43528",
    customerType: "route_partner",
    placement: "Front porch",
    placementOther: "",
    consent: true,
  },
  dogs: [{
    id: 1,
    matchMode: "individual",
    sameAsDogId: null,
    lifeStage: "adult",
    breedSize: "medium",
    activity: "moderate",
    metabolism: "average",
    bodyCondition: "ideal",
    goal: "maintain",
    jointNeeds: ["none"],
    digestion: "no",
    skinCoat: "no",
    priority: "balanced",
  }],
  recommendations: [],
  orderLines: [],
  plan: "subscription",
  delivery: "route_day",
  totals: { subtotal: 60, fee: 0, tax: 4.65, total: 64.65 },
};

async function submit(body) {
  const response = await fetch(`${base}/api/dog-food/order/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

const valid = await submit(payload);
check(valid.response.status === 200 && valid.body.ok, `Weight-free order failed: ${JSON.stringify(valid.body)}`);

const missingPlacement = await submit({ ...payload, customer: { ...payload.customer, placement: "Other", placementOther: "" } });
check(missingPlacement.response.status === 400, "An empty custom placement should be rejected.");

const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).find((part) => part.type === "hour")?.value || 24);
let cutoff = "not-applicable-before-noon";
if (hour >= 12) {
  const sameDay = await submit({ ...payload, plan: "on_demand", delivery: "same_day", customer: { ...payload.customer, customerType: "on_demand" } });
  check(sameDay.response.status === 400 && /12:00 PM Eastern/.test(sameDay.body.error || ""), `Same-day cutoff failed: ${JSON.stringify(sameDay.body)}`);
  cutoff = "verified";
}

console.log(JSON.stringify({ ok: true, orderNumber: valid.body.orderNumber, weightFreeQuestionnaire: "verified", customPlacement: "verified", sameDayCutoff: cutoff }));
