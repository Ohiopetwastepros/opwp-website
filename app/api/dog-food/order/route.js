import { cancelDogFoodFollowUp, saveSubmission } from "@/lib/db";

export const runtime = "nodejs";

function validText(value, max = 200) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const customer = body?.customer ?? {};
    const dogs = Array.isArray(body?.dogs) ? body.dogs : [];

    if (!validText(customer.firstName, 80) || !validText(customer.lastName, 80) ||
        !validText(customer.email, 200) || !customer.email.includes("@") ||
        !validText(customer.phone, 40) || !validText(customer.address, 200) ||
        !validText(customer.city, 100) || !/^\d{5}$/.test(customer.zip ?? "")) {
      return Response.json({ error: "Please complete all required customer and delivery fields." }, { status: 400 });
    }

    const earlierDogIds = new Set();
    const invalidDogs = dogs.some((dog, index) => {
      const weight = Number(dog?.weight);
      const copiesEarlierDog = index > 0 && dog?.matchMode === "same_food" &&
        earlierDogIds.has(Number(dog?.sameAsDogId));
      const hasQuestionnaire = dog?.matchMode === "individual" &&
        Number.isFinite(weight) && weight > 0 && weight <= 300 &&
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
