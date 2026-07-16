import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";

export async function middleware(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (auth.authorized) return NextResponse.next();
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="OPWP Executive Cockpit", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
