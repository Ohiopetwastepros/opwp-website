import { cancelDogFoodFollowUp, saveSubmission } from "@/lib/db";

export const runtime = "nodejs";

function validText(value, max = 200) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function sameDayOrderingOpen() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value || 24) < 12;
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

    if (body.partialSubmissionId) {
      await cancelDogFoodFollowUp(body.partialSubmissionId);
    }

    return Response.json({
      ok: true,
      orderNumber: `EDF-${stored.id.slice(0, 8).toUpperCase()}`,
      stored: stored.configured,
    });
  } catch {
    return Response.json({ error: "We could not submit the order. Please try again." }, { status: 500 });
  }
}
