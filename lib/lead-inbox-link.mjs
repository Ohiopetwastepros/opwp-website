import {inboxState, sortInbox} from './lead-inbox.mjs';

// A staff link can select an already authorized, loaded lead only. It never
// fetches an arbitrary record or treats a URL as an identifier.
export function initialLeadInboxSelection(leads = [], requestedId = '') {
  const valid = typeof requestedId === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(requestedId);
  const requested = valid ? leads.find(lead => lead.id === requestedId) : null;
  if (requested) return {id: requested.id, view: inboxState(requested).view};
  return {id: sortInbox(leads).find(lead => inboxState(lead).view === 'attention')?.id || '', view: 'attention'};
}
