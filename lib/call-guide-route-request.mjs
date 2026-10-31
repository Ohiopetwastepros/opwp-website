import { readBoundedProviderJson } from './bounded-body.mjs';

export async function callGuideRouteInput(request) {
  let body;
  try { body = await readBoundedProviderJson(request, 4096); }
  catch (error) { return { response: Response.json({ ok: false, error: error instanceof RangeError ? 'Route request is too large.' : 'Enter valid service address details.' }, { status: error instanceof RangeError ? 413 : 400 }) }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: Response.json({ ok: false, error: 'Enter the full service address.' }, { status: 400 }) };
  if (typeof body.address === 'string' && !body.city && !body.zip) {
    const parts = body.address.trim().match(/^(.+),\s*([^,]+),\s*(OH|MI)\s*,?\s*(\d{5})$/i);
    if (parts) body = { ...body, address: parts[1].trim(), city: parts[2].trim(), state: parts[3].toUpperCase(), zip: parts[4] };
  }
  const limits = { address: 250, city: 100, state: 2, zip: 5, frequency: 30 };
  for (const [key, max] of Object.entries(limits)) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > max || /[\x00-\x1f]/.test(body[key])) return { response: Response.json({ ok: false, error: 'Enter the complete street, city, state, and five-digit ZIP.' }, { status: 400 }) };
  }
  if (!/^\d{5}$/.test(body.zip) || !/^(OH|MI)$/i.test(body.state) || !['once_a_week', 'twice_a_week', 'every_other_week', 'once_a_month', 'one_time'].includes(body.frequency)) return { response: Response.json({ ok: false, error: 'Check the service address and frequency.' }, { status: 400 }) };
  if (!['number', 'string'].includes(typeof body.monthly_revenue)) return { response: Response.json({ ok: false, error: 'Check the monthly quote.' }, { status: 400 }) };
  const revenue = Number(body.monthly_revenue);
  if (!Number.isFinite(revenue) || revenue < 0 || revenue > 10000) return { response: Response.json({ ok: false, error: 'Check the monthly quote.' }, { status: 400 }) };
  return { body: { ...Object.fromEntries(Object.keys(limits).map(key => [key, body[key].trim()])), monthly_revenue: revenue } };
}
