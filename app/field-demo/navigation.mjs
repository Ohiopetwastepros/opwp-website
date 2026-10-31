// A visit is identified by its stop ID, never by a shared street address.
export function visitAfterService(day, taskId) {
  const stop = day.stops.find(item => item.tasks.some(task => task.id === taskId));
  return stop?.tasks.some(task => !['completed', 'skipped'].includes(task.status)) ? stop.id : '';
}

export function visibleService(stop, selectedId) {
  if (selectedId === `${stop?.id}:collapsed`) return null;
  return stop?.tasks.find(task => task.id === selectedId)?.id
    || stop?.tasks.find(task => task.status === 'working')?.id
    || stop?.tasks.find(task => !['completed', 'skipped'].includes(task.status))?.id
    || null;
}

export function visibleVisit(day, selectedId) {
  if (!day) return null;
  return day.stops.find(stop => stop.tasks.some(task => task.status === 'working'))
    || day.stops.find(stop => stop.id === selectedId)
    || day.stops.filter(stop => stop.status === 'arrived').sort((a, b) => Date.parse(b.arrivedAt) - Date.parse(a.arrivedAt))[0]
    || day.stops.find(stop => stop.status !== 'finished')
    || day.stops.at(-1);
}
