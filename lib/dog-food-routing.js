import { readLiveDensity } from './live-density-store.mjs';
import { densityAddressHash, densityDistance, localReliableGeocode, DENSITY_DAYS } from './live-density.mjs';
import { easternFoodDate, shiftFoodDays } from './dog-food-cadence.mjs';
import { fieldQuota } from './field-quota.mjs';
import { geocodeAddress } from './geoapify';
import {foodWebsiteState} from './dog-food-website-store.mjs';

const normalized=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export async function locateFoodAddress(db,account,address) {
  const text=[address.line1,address.city,address.state,address.postal_code].join(', '),hash=await densityAddressHash(text);
  let match=await db.prepare('SELECT * FROM route_geocode_cache WHERE address_hash=?').bind(hash).first();
  if(!match && await fieldQuota(db,account.id,'food-profile-geocode',3,86400) && await fieldQuota(db,'org-opwp','food-profile-geocode-global',100,86400)) {
    const result=await geocodeAddress(text);
    if(result?.ok && result.data.stateCode===address.state && String(result.data.postcode).slice(0,5)===address.postal_code) {
      const g=result.data;match={latitude:g.latitude,longitude:g.longitude,confidence:g.confidence,match_type:g.matchType};
      if(localReliableGeocode(match))await db.prepare(`INSERT INTO route_geocode_cache(address_hash,normalized_address,latitude,longitude,formatted_address,confidence,match_type,provider_place_id)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(address_hash) DO NOTHING`).bind(hash,text,g.latitude,g.longitude,String(g.formattedAddress||'').slice(0,512),g.confidence,g.matchType,String(g.placeId||'').slice(0,512)).run();
    }
  }
  return localReliableGeocode(match)?{latitude:Number(match.latitude),longitude:Number(match.longitude)}:{latitude:null,longitude:null};
}
export function foodRouteRecommendation(source,address,now=new Date()) {
  if(!source || source.stale || source.status!=='success')return {status:'unavailable',days:[],message:'Current route information is unavailable. Pickup or confirmed Tony delivery dates may still be available.'};
  const rows=source.clients.filter(c=>c.zip===address.postal_code && address.state===(String(c.zip).startsWith('48')?'MI':'OH') && c.serviceDays?.length);
  const exact=rows.filter(c=>normalized(c.address)===normalized(address.line1)&&normalized(c.city)===normalized(address.city));
  const located=Number.isFinite(address.latitude)&&Number.isFinite(address.longitude);
  const nearest=located?rows.filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon)).map(c=>({...c,distance:densityDistance({lat:address.latitude,lon:address.longitude},c)})).sort((a,b)=>a.distance-b.distance).slice(0,3):[];
  const evidence=exact.length?exact:nearest.length?nearest:rows;
  const ranked=DENSITY_DAYS.map(day=>({day,weekday:DENSITY_DAYS.indexOf(day)+1,score:evidence.filter(c=>c.serviceDays.includes(day)).reduce((n,c)=>n+(nearest.length&&!exact.length?1/(.25+c.distance):1),0)}))
    .filter(d=>d.score>0).sort((a,b)=>b.score-a.score||a.weekday-b.weekday);
  const today=easternFoodDate(now),weekday=new Date(today+'T12:00:00Z').getUTCDay();
  return {status:rows.length?'available':'outside_route',capturedAt:source.capturedAt,days:ranked.map(({day,weekday:w})=>({day,weekday:w,nextDate:shiftFoodDays(today,(w-weekday+7)%7||7)})),
    basis:exact.length||nearest.length?'address_routes':'zip_routes',message:rows.length?exact.length||nearest.length?'Recommended from current OPWP routes near your saved address.':'Recommended from active OPWP routes in your ZIP; the office confirms address coverage.':'Your address is outside our current route coverage. Choose pickup or an office-confirmed Tony delivery.'};
}
export async function readFoodDeliveryChoices(db,address,{now=new Date()}={}) {
  if(!address)return {status:'profile_required',days:[],tonyDates:[]};
  // Preserve the existing Ohio food-delivery boundary. Outside-area addresses
  // can use pickup; out-of-state delivery needs an office-approved tax policy.
  if(address.state!=='OH')return {status:'outside_route',days:[],tonyDates:[],deliveryAvailable:false,pickupAvailable:true,message:'Online food delivery currently supports Ohio addresses. Choose pickup by arrangement or contact the office for other delivery options.'};
  const website=(await foodWebsiteState(db)).backend==='website';
  const source=website?null:await readLiveDensity(db,{now}).catch(()=>null),route=foodRouteRecommendation(source,address,now);
  // Only aggregates leave the server. Never return the OPWP roster, addresses, IDs or workload.
  const today=easternFoodDate(now);
  const slots=(await db.prepare(`SELECT DISTINCT service_date FROM dog_food_delivery_capacity s WHERE fulfillment_method='delivery' AND enabled=1 AND postal_code=?
    AND (technician_name='Tony' OR technician_name LIKE 'Tony %') AND service_date>=? AND service_date<=? AND bag_limit>(SELECT COALESCE(SUM(bags),0) FROM dog_food_capacity_allocations WHERE slot_id=s.id AND released_at IS NULL)
    AND stop_limit>(SELECT COUNT(*) FROM dog_food_capacity_allocations WHERE slot_id=s.id AND released_at IS NULL) ORDER BY service_date LIMIT 31`).bind(address.postal_code,today,shiftFoodDays(today,31)).all()).results||[];
  const local=address.state===(address.postal_code.startsWith('48')?'MI':'OH');
  const tonyDates=local?slots.map(s=>s.service_date):[];
  if(website){
    const capacity=(await db.prepare(`SELECT DISTINCT service_date FROM dog_food_delivery_capacity s WHERE enabled=1 AND fulfillment_method='delivery' AND postal_code=? AND service_date>=? AND service_date<=?
      AND bag_limit>(SELECT COALESCE(SUM(bags),0) FROM dog_food_capacity_allocations WHERE slot_id=s.id AND released_at IS NULL) AND stop_limit>(SELECT COUNT(*) FROM dog_food_capacity_allocations WHERE slot_id=s.id AND released_at IS NULL) ORDER BY service_date LIMIT 31`).bind(address.postal_code,today,shiftFoodDays(today,31)).all()).results||[];
    const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],seen=new Set(),days=[];
    for(const r of capacity){const weekday=new Date(r.service_date+'T12:00:00Z').getUTCDay();if(weekday>=1&&weekday<=5&&!seen.has(weekday)){seen.add(weekday);days.push({day:weekdays[weekday],weekday,nextDate:r.service_date});}}
    return {backend:'website',status:days.length||tonyDates.length?'available':'outside_route',days,tonyDates,deliveryAvailable:Boolean(days.length||tonyDates.length),pickupAvailable:true,capturedAt:new Date().toISOString(),basis:'office_confirmed_capacity',message:days.length||tonyDates.length?'Delivery dates use office-confirmed website capacity.':'No confirmed delivery capacity for this ZIP yet. Choose pickup or contact the office.'};
  }
  return {...route,tonyDates,deliveryAvailable:route.status==='available'||tonyDates.length>0,pickupAvailable:true};
}
