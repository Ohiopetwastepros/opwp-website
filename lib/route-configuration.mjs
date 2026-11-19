import staffPrivate from './staff-private.json' with { type: 'json' };

const weekdays = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

// Editable roster metadata; existing source assignments remain authoritative.
// null keeps daily admission limits OFF. Availability/active flags describe the
// intended roster and do not silently reassign or filter existing source work.
export const ROUTING_CONFIGURATION = Object.freeze({
  maxDailyMinutes: null,
  technicians: Object.freeze([
    Object.freeze({ role: 'primary', name: staffPrivate.primaryName, aliases: Object.freeze([staffPrivate.primaryName, staffPrivate.primaryShort]), employment: 'full_time', active: true,
      maxDailyMinutes: null, availableDays: weekdays, depotReference: 'depotAddress' }),
    Object.freeze({ role: 'relief', name: staffPrivate.reliefName, aliases: Object.freeze([staffPrivate.reliefName, staffPrivate.reliefShort]), employment: 'part_time', active: true,
      maxDailyMinutes: null, availableDays: Object.freeze(['Monday']), depotReference: null }),
    Object.freeze({ role: 'future', name: staffPrivate.futureName || 'Future technician', employment: 'part_time', active: false,
      maxDailyMinutes: null, availableDays: Object.freeze([]), depotReference: null }),
  ]),
});

const normalizedName = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function routingTechnicianConfiguration(name, configuration = ROUTING_CONFIGURATION) {
  const key = normalizedName(name);
  if (!key) return null;
  return configuration.technicians?.find(technician => [technician.name, ...(technician.aliases || [])].some(alias => normalizedName(alias) === key)) || null;
}

const configuredLimit = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

// Future capacity checks are explicit metadata. With the owner-approved default
// no cap is imposed, and recommendation availability/ranking stays unchanged.
export function optionalRouteCapacity({ technician, plannedMinutes, serviceMinutes, insertionMinutes, metricsVerified, depotIncluded, knownDepot = false }, configuration = ROUTING_CONFIGURATION) {
  const roster = routingTechnicianConfiguration(technician, configuration);
  const limits = [configuredLimit(configuration.maxDailyMinutes), configuredLimit(roster?.maxDailyMinutes)].filter(value => value !== null);
  if (!limits.length) return { capacityLimitEnabled: false, maxDailyMinutes: null, capacityStatus: 'not_configured', capacityExceeded: false };
  const maxDailyMinutes = Math.min(...limits);
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const verified = metricsVerified && [plannedMinutes, serviceMinutes, insertionMinutes].every(valid)
    && (!(knownDepot || roster?.depotReference) || depotIncluded === true);
  if (!verified) return { capacityLimitEnabled: true, maxDailyMinutes, capacityStatus: 'unverified', capacityExceeded: null };
  const projectedMinutes = plannedMinutes + serviceMinutes + insertionMinutes;
  return { capacityLimitEnabled: true, maxDailyMinutes, capacityStatus: projectedMinutes > maxDailyMinutes ? 'over_limit' : 'within_limit',
    capacityExceeded: projectedMinutes > maxDailyMinutes, capacityProjectedMinutes: projectedMinutes, capacityRemainingMinutes: maxDailyMinutes - projectedMinutes };
}
