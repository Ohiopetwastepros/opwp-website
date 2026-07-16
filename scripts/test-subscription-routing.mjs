import { airtableFrequency, serviceDays } from "../lib/subscription-refresh-worker.js";

if (airtableFrequency("once_a_week") !== "Weekly") throw new Error("Weekly frequency mapping failed.");
if (airtableFrequency("two_times_a_week") !== "Twice Weekly") throw new Error("Twice-weekly frequency mapping failed.");
if (airtableFrequency("bi_weekly") !== "Biweekly") throw new Error("Biweekly frequency mapping failed.");
if (serviceDays("Thursday, Monday").join(",") !== "Monday,Thursday") throw new Error("Service-day parsing failed.");

console.log("Subscription routing rules passed.");
