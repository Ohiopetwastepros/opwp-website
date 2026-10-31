import { refreshLiveDensity } from './live-density-store.mjs';
import { geocodeAddress } from './geoapify';
export async function runScheduledDensityRefresh(env) {
  try {
    const result=await refreshLiveDensity(env,{geocode:geocodeAddress});
    console.log(JSON.stringify({event:'acquisition_density_refresh',refreshed:result.refreshed,status:result.source?.status||'unavailable',clients:result.source?.clients?.length||0,providerPages:result.source?.providerPages||0}));
    return {refreshed:result.refreshed,status:result.source?.status||'unavailable'};
  }catch {console.error(JSON.stringify({event:'acquisition_density_refresh_failed'}));return {refreshed:false,status:'failed'};}
}
