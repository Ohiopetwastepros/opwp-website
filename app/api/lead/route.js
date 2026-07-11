import { saveSubmission } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const saved = await saveSubmission({
    kind: body.source === "question" ? "question" : "partial_quote",
    source: "website",
    body,
  });
  return Response.json({ ok: true, stored: saved.configured, id: saved.id });
}
