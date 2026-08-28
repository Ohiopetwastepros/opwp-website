const ORGANIZATION = "ohio-pet-waste-pros-qkr3c";
const URL = `https://api.sweepandgo.com/api/client_on_boarding/service_registration_form?organization=${ORGANIZATION}`;

const EXPECTED_OPTIONS = {
  number_of_dogs: "1,2,3,4,5,6,7",
  clean_up_frequency: "two_times_a_week,once_a_week,bi_weekly,once_a_month,one_time",
  last_time_yard_was_thoroughly_cleaned: "one_week,two_weeks,three_weeks,one_month,two_months,3-4_months,5-6_months,7-9_months,10+_months",
  safe_dog: "yes,no",
  gate_location: "left,right,alley,no_gate,other",
  doggie_door: "yes,no",
  garbage_can_location: "left,right,alley,other",
  areas_to_clean: "Back Yard,Behind Shed,Kids Play Area,Area with Mulch,Area with Rocks,Pool Area,Area With Pine Straw",
  cleanup_notification_type: "off_schedule,on_the_way,completed",
  cleanup_notification_chanel: "email,sms,call",
  how_heard_about_us: "search_engine,previous_client,referred_by_family_or_friend,social_media,vehicle_signage,yard_sign,gift_certificate,other",
};

const EXPECTED_REQUIRED = [
  "number_of_dogs", "clean_up_frequency", "last_time_yard_was_thoroughly_cleaned",
  "first_name", "last_name", "your_email_address", "confirm_email_address",
  "cell_phone_number", "home_address", "city", "state_province_region", "safe_dog",
  "gate_location", "garbage_can_location", "cleanup_notification_type",
  "cleanup_notification_chanel", "how_heard_about_us",
].sort();

const response = await fetch(URL, {
  headers: {
    "x-sng-frontend": "true",
    origin: "https://client.sweepandgo.com",
    referer: "https://client.sweepandgo.com/",
  },
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) throw new Error(`Sweep & Go form audit failed with HTTP ${response.status}`);
const data = await response.json();
const visible = (data.form_fields || []).filter((field) => field.show);
const bySlug = new Map(visible.map((field) => [field.slug, field]));
const problems = [];

for (const [slug, expected] of Object.entries(EXPECTED_OPTIONS)) {
  const actual = bySlug.get(slug)?.value;
  if (actual !== expected) problems.push(`${slug}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

const required = visible.filter((field) => field.required).map((field) => field.slug).sort();
if (JSON.stringify(required) !== JSON.stringify(EXPECTED_REQUIRED)) {
  problems.push(`required fields changed: ${JSON.stringify(required)}`);
}

if (problems.length) {
  console.error("Sweep & Go form configuration drift detected:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Sweep & Go form configuration matches the audited OPWP contract (${visible.length} visible fields).`);
}
