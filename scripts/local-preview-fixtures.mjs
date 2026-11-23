// Fabricated click-through data only. These names, properties and contacts are
// not operational records and must never be used for messaging or service.
export const LOCAL_PREVIEW_SEED_VERSION = 'route-os-local-v1';
export const LOCAL_PREVIEW_ACTOR = 'craig.preview@example.test';
const people = ['Alex Morgan', 'Jamie Reed', 'Taylor Brooks', 'Casey Patel', 'Jordan Ellis', 'Morgan Shaw', 'Avery Bennett', 'Riley Carter', 'Quinn Foster', 'Parker Hayes', 'Cameron Hill', 'Drew James', 'Emery King', 'Finley Lane', 'Harper Lewis', 'Kendall Moore', 'Logan Nash', 'Peyton Owens', 'Reese Price', 'Rowan Quinn', 'Skyler Ross', 'Sydney Stone', 'Terry Taylor', 'Blair Vega', 'Charlie West'];
const areas = [
  { city: 'Holland', zip: '43528', lat: 41.621, lng: -83.711, street: 'Cedar Ridge Lane' },
  { city: 'Sylvania', zip: '43560', lat: 41.718, lng: -83.713, street: 'Willow Bend Court' },
  { city: 'Perrysburg', zip: '43551', lat: 41.557, lng: -83.627, street: 'River Birch Drive' },
  { city: 'Maumee', zip: '43537', lat: 41.562, lng: -83.655, street: 'Oak Hollow Drive' },
  { city: 'Toledo', zip: '43615', lat: 41.653, lng: -83.672, street: 'Meadow Brook Lane' },
];
export function localPreviewCustomers() {
  return people.map((name, index) => {
    const number = index + 1, suffix = String(number).padStart(2, '0'), area = areas[index % areas.length];
    return { id: `local-customer-${suffix}`, subscriptionId: `local-subscription-${suffix}`, name, displayName: `${name} - ${area.city}`,
      city: area.city, zip: area.zip, street: `${200 + number * 7} ${area.street}`, state: 'OH', country: 'US',
      lat: area.lat + Math.floor(index / 5) * 0.002, lng: area.lng + Math.floor(index / 5) * 0.0015,
      email: `${name.toLowerCase().replaceAll(' ', '.')}@local-preview.example.test`, phone: `+14195550${100 + number}`,
      dogCount: index % 6 + 1, dogNames: ['Scout', 'Piper', 'Buddy', 'Luna', 'Max', 'Rosie'].slice(0, index % 6 + 1),
      yardTierId: ['tiny', 'small', 'medium', 'large'][index % 4],
      frequency: number === 24 ? 'one_time' : number % 3 === 2 && index % 6 + 1 <= 3 ? 'every_other_week' : 'once_a_week',
      scenario: ({ 1: 'deodorization_amendment', 2: 'dog_count_amendment', 3: 'frequency_amendment', 4: 'manual_override', 7: 'promised_credit', 8: 'missing_method', 21: 'paused', 22: 'cancelled', 23: 'past_due', 24: 'one_time', 25: 'new_client' })[number] || 'active',
      addOnIds: number === 1 ? ['kitty_litter', 'deodorize'] : number === 3 ? ['kitty_litter', 'kitty_litter_extra_box'] : number === 6 ? ['haul_away'] : number === 9 ? ['deodorize'] : number === 12 ? ['kitty_litter_changeout'] : number === 25 ? ['kitty_litter'] : number % 5 === 0 ? ['sani_monthly'] : [],
      // Access instructions are intended for the field-device allowlist.
      gateSide: number % 4 === 0 ? 'Left' : 'Right', gateCode: number === 1 || number === 7 ? '2468' : number === 3 ? '7314' : '',
      accessNotes: number % 4 === 0 ? 'Use left side gate. Close the upper latch after service.' : 'Use right side gate. Keep the gate closed while working.',
      safetyNotes: number === 5 ? 'Unsafe dog reported: Max may be loose in the yard. Do not enter until the office confirms safe access.' : 'Dogs stay inside during service. Confirm the yard is clear before entering.',
      persistentNotes: number === 5 ? 'The gate latch sticks. Lift the gate slightly before securing the latch.' : number % 3 === 0 ? 'Include the side run along the garage. Place sealed waste in the marked gray bin.' : 'Service the back yard and check the fence line. Photograph the latched gate before leaving.',
      todayNotes: number === 1 ? 'Please check the leaf pile beside the shed. Service one litter box in the mudroom.' : number === 3 ? 'Two litter boxes are in the enclosed porch. Fresh liners are on the shelf.' : number === 10 ? 'Deliver one Blue Bag to the covered side door, beside the storage bench.' : number === 5 ? 'Office safety review required before entry.' : 'Follow the usual service instructions.',
      foodDelivery: number === 10 ? { productId: 'local-food-blue-40', name: 'Blue Bag', color: 'Blue', weightLb: 40, quantity: 1, placement: 'Covered side door, beside the storage bench.' } : null,
    };
  });
}
