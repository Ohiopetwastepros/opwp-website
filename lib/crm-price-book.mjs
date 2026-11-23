import { PRICING, PRICING_VERSION, YARD_TIERS } from '../app/free-quote/pricing.js';

// Preserve the verified source's fixed MONTHLY totals for each service schedule.
// No live records, invented litter prices or alternative branch pricing are seeds.
export function defaultCrmPriceBook() {
  const rates = [];
  for (const [frequency, grid] of Object.entries(PRICING.monthly)) {
    for (const [dogs, dollars] of Object.entries(grid)) {
      if (dollars == null) continue;
      rates.push({ frequency, dogCount: Number(dogs), zoneId: 'service-area', baseCents: grid[1] * 100, extraDogsCents: (dollars - grid[1]) * 100 });
    }
  }
  return {
    id: 'opwp-recurring-services', version: 1, effectiveDate: '2026-11-18', currency: 'USD',
    sourceVersion: PRICING_VERSION,
    plans: [{ id: 'yard_cleanup', label: 'Yard cleanup', rates }],
    zones: [{ id: 'service-area', label: 'Approved service area', zips: [...PRICING.serviceZips] }],
    yardTiers: YARD_TIERS.filter(tier => Number.isInteger(tier.upcharge)).map(tier => ({ id: tier.id, label: tier.label, upchargeCents: tier.upcharge * 100 })),
    // One-time/product/per-treatment prices require an approved recurring cadence
    // before becoming subscription lines. Existing public quotes are unchanged.
    addons: PRICING.addons.filter(item => item.charge === 'monthly' && item.price3Plus == null).map(item => ({ id: item.id, label: item.name, unitCents: item.price * 100, unitLabel: 'month', billingCadence: 'monthly' })),
  };
}
