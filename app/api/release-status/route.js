import release from '@/lib/deployment-release.json';
// Fixed public health response: no database work, user input, or private release details.
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ id: release.id }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
