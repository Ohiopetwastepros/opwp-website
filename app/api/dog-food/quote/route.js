import { queueDogFoodFollowUp, saveSubmission } from "@/lib/db";

export const runtime = "nodejs";

const CONSENT_TEXT = "I consent to receive marketing and service messages from Ohio Pet Waste Pros at the phone number provided. Message frequency may vary; message & data rates may apply. Reply STOP to opt out.";

export async function POST(request) {
  try {
    const body = await request.json();
    const customer = body?.customer ?? {};
    const phoneDigits = String(customer.phone ?? "").replace(/\D/g, "");

    if (!customer.consent || !String(customer.firstName ?? "").trim() ||
        !String(customer.lastName ?? "").trim() || !String(customer.email ?? "").includes("@") ||
        phoneDigits.length < 10) {
      return Response.json({ error: "Complete the quote fields and text consent before continuing." }, { status: 400 });
    }

    const saved = await saveSubmission({
      kind: "dog_food_partial_quote",
      source: "dog_food_tool",
      status: "follow_up_pending",
      body: {
        ...body,
        first_name: customer.firstName.trim(),
        last_name: customer.lastName.trim(),
        email: customer.email.trim(),
        phone: customer.phone.trim(),
        sms_consent: true,
        sms_consent_text: CONSENT_TEXT,
        sms_consent_at: new Date().toISOString(),
      },
    });

    const followUp = await queueDogFoodFollowUp({
      submissionId: saved.id,
      phone: customer.phone.trim(),
      consentText: CONSENT_TEXT,
      delayMinutes: 15,
    });

    return Response.json({ ok: true, stored: saved.configured, queued: followUp.queued, id: saved.id });
  } catch (error) {
    console.error(JSON.stringify({ event: "dog_food_partial_quote_failed", message: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: "We could not save the quote. Please try again." }, { status: 500 });
  }
}
