import staffPrivate from './staff-private.json' with {type:'json'};
import {applyTechnicianRouteCosts as calculate} from './quickbooks-route-cost-calculations.mjs';
export {COST_GROUPS,parseRouteCostReport,applyQuickBooksRouteCosts,combineTechnicianDays} from './quickbooks-route-cost-calculations.mjs';
export function applyTechnicianRouteCosts(facts,costSource,coverage={}) { return calculate(facts,costSource,{...coverage,ownerKey:staffPrivate.reliefKey}); }
