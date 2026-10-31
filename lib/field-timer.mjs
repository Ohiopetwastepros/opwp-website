// Derive elapsed time from timestamps, never from the number of browser ticks.
// This keeps the clock correct after screen lock, backgrounding and offline use.
export function jobTimer(startedAt, completedAt, allottedMinutes, now = Date.now()) {
  const parse = value => !value ? NaN : Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  const start = parse(startedAt), finish = parse(completedAt);
  const elapsedSeconds = Number.isFinite(start) ? Math.max(0, Math.floor(((Number.isFinite(finish) ? finish : now) - start) / 1000)) : 0;
  const allottedSeconds = Math.max(0, Math.round(Number(allottedMinutes || 0) * 60));
  const over = allottedSeconds > 0 && elapsedSeconds > allottedSeconds;
  return { elapsedSeconds, allottedSeconds, over, overtimeSeconds: Math.max(0, elapsedSeconds - allottedSeconds), progress: allottedSeconds ? Math.min(100, elapsedSeconds / allottedSeconds * 100) : 0 };
}
export function clockText(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
