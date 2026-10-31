export function workdayInsights(days) {
  const services = new Map();
  let assigned = 0,
    completed = 0,
    skipped = 0,
    timed = 0,
    measured = 0;
  for (const day of days)
    for (const stop of day.stops)
      for (const task of stop.tasks) {
        assigned++;
        if (task.status === "completed") completed++;
        if (task.status === "skipped") skipped++;
        if (!task.timed) continue;
        timed++;
        const seconds =
          (Date.parse(task.completedAt) - Date.parse(task.startedAt)) / 1000;
        if (
          task.status !== "completed" ||
          !Number.isFinite(seconds) ||
          seconds <= 0 ||
          seconds > 8 * 3600 ||
          !Number.isInteger(task.quantity) ||
          task.quantity < 1
        )
          continue;
        measured++;
        const row = services.get(task.serviceId) || {
          id: task.serviceId,
          name: task.title,
          unitLabel: task.unitLabel,
          samples: [],
          expected: [],
        };
        row.samples.push(seconds / 60 / task.quantity);
        row.expected.push(task.estimatedMinutes / task.quantity);
        services.set(task.serviceId, row);
      }
  return {
    workdays: days.length,
    assigned,
    completed,
    skipped,
    timingCoverage: timed ? Math.round((measured / timed) * 100) : 0,
    services: [...services.values()]
      .map((row) => {
        const sorted = row.samples.sort((a, b) => a - b),
          n = sorted.length,
          median =
            n % 2
              ? sorted[(n - 1) / 2]
              : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
        return {
          id: row.id,
          name: row.name,
          unitLabel: row.unitLabel,
          samples: n,
          medianMinutesPerUnit: Math.round(median * 10) / 10,
          meanAllowanceMinutes:
            Math.round((row.expected.reduce((a, b) => a + b, 0) / n) * 10) / 10,
          suggestedMinutesPerUnit:
            n >= 5
              ? Math.min(240, Math.max(0.5, Math.round(median * 2) / 2))
              : null,
        };
      })
      .sort((a, b) => b.samples - a.samples),
  };
}
