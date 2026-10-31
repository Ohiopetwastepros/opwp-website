import staffPrivate from './staff-private.json' with {type:'json'};
import {calculateClosedWeekCapacity} from './live-density-calculations.mjs';
export * from './live-density-calculations.mjs';
export function closedWeekCapacity(data,now=new Date()){return calculateClosedWeekCapacity(data,now,staffPrivate);}
