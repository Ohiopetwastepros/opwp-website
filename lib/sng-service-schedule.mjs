const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function airtableFrequency(value) {
  const frequency = normalized(value);
  if (/2xw/.test(frequency) || /^\d+d2w$/.test(frequency) || ["twiceaweek", "twotimesaweek", "twiceweekly"].includes(frequency)) return "Twice Weekly";
  if (/bw/.test(frequency) || ["biweekly", "everyotherweek", "onceeverytwoweeks"].includes(frequency)) return "Biweekly";
  if (/1xw/.test(frequency) || /^\d+d(?:1)?w$/.test(frequency) || frequency === "w" || ["onceaweek", "weekly", "onceweekly"].includes(frequency)) return "Weekly";
  if (/1xm/.test(frequency) || /^\d+d(?:1)?m$/.test(frequency) || frequency === "m" || ["monthly", "onceamonth"].includes(frequency)) return "Monthly";
  return "";
}

export function serviceDays(value) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,/&]+|\band\b/i);
  const found = [];
  for (const item of source) {
    const text = String(item?.day ?? item?.name ?? item ?? "").trim().toLowerCase();
    const day = WEEKDAYS.find((candidate) => text === candidate.toLowerCase() || text.startsWith(candidate.slice(0, 3).toLowerCase()));
    if (day && !found.includes(day)) found.push(day);
  }
  return found.sort((left, right) => WEEKDAYS.indexOf(left) - WEEKDAYS.indexOf(right));
}

export function assignedTechnicians(value) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,/]+|\band\b/i);
  const found = [];
  for (const item of source) {
    const name = String(item?.name ?? item ?? "").trim();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

export function sngScheduleValues(client = {}) {
  const frequency = airtableFrequency(client.cleanup_frequency);
  const days = serviceDays(client.service_days);
  const technicians = assignedTechnicians(client.assigned_to);
  let assignedTech = technicians[0] || "";
  let assignedTech2 = "";

  if (days.length > 1) {
    assignedTech2 = technicians[1] || assignedTech;
  } else if (technicians.length > 1) {
    assignedTech = technicians.join(", ");
  }

  return { frequency, days, technicians, assignedTech, assignedTech2 };
}
