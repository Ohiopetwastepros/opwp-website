import { getRuntimeEnv } from "@/lib/cloudflare";
import { getReviewPreviewImage } from "@/lib/review-previews.mjs";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { token } = await params;
  return getReviewPreviewImage(getRuntimeEnv(), token);
}
