const EASTERN_TIME_ZONE = "America/New_York";

function hourInTimeZone(scheduledTime, timeZone) {
  const date = new Date(scheduledTime);
  if (!Number.isFinite(date.getTime())) throw new Error("Scheduled time is invalid.");
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value;
  return Number(hour);
}

export function isEasternMidnight(scheduledTime) {
  return hourInTimeZone(scheduledTime, EASTERN_TIME_ZONE) === 0;
}

export function isUtcHour(scheduledTime, expectedHour) {
  return hourInTimeZone(scheduledTime, "UTC") === Number(expectedHour);
}
