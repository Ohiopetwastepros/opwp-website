export const DENSITY_ASSUMPTIONS={mrr:100,visits:52/12,wage:30,service:8,dense:3,sparse:15,denseMiles:1,sparseMiles:5,mileCost:.7,supplies:1,cac:150,newStops:10};
export function densityEconomics(values) {
  const n=key=>{const v=Number(values[key]);return Number.isFinite(v)?Math.max(0,Math.min(100000,v)):0;};
  const remainder=mode=>n('mrr')-n('visits')*((n('service')+n(mode))/60*n('wage')+n(`${mode}Miles`)*n('mileCost')+n('supplies'));
  const dense=remainder('dense'),sparse=remainder('sparse');
  return {dense,sparse,advantage:dense-sparse,densePayback:dense>0?n('cac')/dense:null,sparsePayback:sparse>0?n('cac')/sparse:null,addedHours:n('newStops')*(n('service')+n('dense'))/60};
}
