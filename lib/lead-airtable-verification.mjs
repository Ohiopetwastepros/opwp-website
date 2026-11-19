import {readBoundedProviderJson} from './bounded-body.mjs';

const dateFields = new Set(['Last Synced', 'Next Action Due', 'Last Activity', 'Captured At']);
export function compareLeadAirtableFields(expected, actual = {}) {
  return Object.keys(expected).filter(field => {
    const wanted = expected[field], observed = actual[field];
    // Airtable omits cleared values and unchecked checkboxes from read responses.
    if (wanted === '') return ![undefined, null, ''].includes(observed);
    if (wanted === null) return ![undefined, null].includes(observed);
    if (wanted === false) return ![undefined, null, false].includes(observed);
    if (dateFields.has(field) && typeof wanted === 'string' && typeof observed === 'string' && Number.isFinite(Date.parse(wanted)) && Number.isFinite(Date.parse(observed))) return Date.parse(wanted) !== Date.parse(observed);
    return JSON.stringify(wanted) !== JSON.stringify(observed);
  });
}
export async function verifyLeadAirtableReadback({env, baseId, tableId, recordId, expected, fetcher}) {
  if (!/^app[A-Za-z0-9]+$/.test(baseId) || !/^tbl[A-Za-z0-9]+$/.test(tableId) || !/^rec[A-Za-z0-9]+$/.test(recordId)) throw new Error('airtable_verification_configuration_invalid');
  const response = await fetcher(`https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`, {
    method: 'GET', redirect: 'manual', headers: {Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: 'application/json'},
  }, {provider: 'airtable', operation: 'yardops_lead_readback', timeoutMs: 12000, retries: 1, retryable: true});
  if (!response.ok) { await response.body?.cancel(); throw new Error('airtable_verification_read_failed'); }
  const result = await readBoundedProviderJson(response, 128 * 1024);
  const differences = compareLeadAirtableFields(expected, result.fields);
  if (result.id !== recordId) differences.push('record_id');
  return {recordId, differences};
}
