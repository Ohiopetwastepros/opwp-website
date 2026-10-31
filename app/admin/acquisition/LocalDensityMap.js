"use client";
import { useEffect,useRef,useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { DENSITY_COLORS } from '@/lib/live-density-constants.mjs';
import styles from './acquisition.module.css';
function safeContent(title,lines) {
  const root=document.createElement('div'),heading=document.createElement('strong');heading.textContent=title;root.append(heading);
  for(const line of lines){const p=document.createElement('p');p.textContent=line;root.append(p);}return root;
}
export default function LocalDensityMap({model,selectedPocket,onPocket,showClients,showPockets,showStudyRadius,day,fitRequest}) {
  const host=useRef(null),instance=useRef(null),layers=useRef(null),selected=useRef(selectedPocket),onSelect=useRef(onPocket),fitted=useRef(false);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[tilesFailed,setTilesFailed]=useState(false);
  const currentModel=useRef(model);currentModel.current=model;
  const membershipKey=model.clients.map(c=>c.id).join(',');
  onSelect.current=onPocket;
  useEffect(()=>{
    let cancelled=false,observer;
    import('leaflet').then(module=>{
      if(cancelled||!host.current)return;const L=module.default||module;
      const map=L.map(host.current,{center:[41.61,-83.63],zoom:11,minZoom:9,maxZoom:18,scrollWheelZoom:false,maxBounds:[[41,-84.6],[42.3,-82.7]],maxBoundsViscosity:.8});
      const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',referrerPolicy:'strict-origin-when-cross-origin',keepBuffer:1});
      let failures=0;tiles.on('tileerror',()=>{if(++failures>=3&&!cancelled)setTilesFailed(true);});tiles.on('tileload',()=>{if(!cancelled)setTilesFailed(false);});tiles.addTo(map);
      L.control.scale({imperial:true,metric:false}).addTo(map);
      instance.current={map,L};layers.current=L.layerGroup().addTo(map);
      observer=new ResizeObserver(()=>map.invalidateSize({pan:false}));observer.observe(host.current);setReady(true);
    }).catch(()=>{if(!cancelled)setError('The interactive map could not load. The pocket list and recommendations remain available.');});
    return ()=>{cancelled=true;observer?.disconnect();instance.current?.map.remove();instance.current=null;layers.current=null;};
  },[]);
  useEffect(()=>{
    if(!ready||!instance.current)return;const {map,L}=instance.current;layers.current.clearLayers();
    const points=model.clients.filter(c=>c.lat!=null&&c.lon!=null);
    if(showPockets)for(const p of model.pockets) {
      const color=DENSITY_COLORS[p.mainDay]||DENSITY_COLORS.Unassigned,chosen=p.id===selectedPocket;
      const circle=L.circle([p.lat,p.lon],{radius:1609.344,color,weight:chosen?3:1.5,fillOpacity:chosen ? .14 : .05});
      circle.on('click',()=>onSelect.current(p.id)).addTo(layers.current);
      const anchor=L.circleMarker([p.lat,p.lon],{radius:chosen?11:8,color:'#fff',weight:2,fillColor:color,fillOpacity:1});
      anchor.bindTooltip(safeContent(String(p.customers),[]),{permanent:true,direction:'center',className:styles.pocketBadge});
      anchor.bindPopup(safeContent(p.displayName,[`${p.customers} verified clients within one mile`,`${p.newCoverage} additional clients covered; ${p.overlap} overlap other pockets`]));
      anchor.on('click',()=>onSelect.current(p.id)).addTo(layers.current);
    }
    const pocket=model.pockets.find(p=>p.id===selectedPocket);
    if(showStudyRadius&&pocket)L.circle([pocket.lat,pocket.lon],{radius:3218.688,color:'#173f55',dashArray:'7 7',weight:2,fill:false,interactive:false}).addTo(layers.current);
    if(showClients)for(const c of points) {
      const color=DENSITY_COLORS[day==='All'?c.serviceDays[0]:day]||DENSITY_COLORS.Unassigned;
      L.circleMarker([c.lat,c.lon],{radius:4.5,color:'#fff',weight:1,fillColor:color,fillOpacity:.95})
        .bindPopup(safeContent(c.name,[c.address,`${c.city} ${c.zip}`,`${c.frequency} · ${c.serviceDays.join(' / ')||'Day unassigned'}`,c.technicians.join(' / ')||'Technician unassigned',c.mrr==null?'Recorded MRR unknown':`Recorded MRR $${c.mrr.toFixed(2)}`])).addTo(layers.current);
    }
    if(!fitted.current&&points.length){map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lon])),{padding:[26,26],maxZoom:13});fitted.current=true;}
  },[ready,model.revision,model.capturedAt,membershipKey,selectedPocket,showClients,showPockets,showStudyRadius,day]);
  useEffect(()=>{
    if(!ready||!instance.current||selected.current===selectedPocket)return;selected.current=selectedPocket;
    const p=model.pockets.find(p=>p.id===selectedPocket);if(p)instance.current.map.setView([p.lat,p.lon],13,{animate:true});
  },[ready,selectedPocket,model]);
  useEffect(()=>{
    if(!ready||!instance.current||!fitRequest)return;const points=currentModel.current.clients.filter(c=>c.lat!=null&&c.lon!=null);if(points.length)instance.current.map.fitBounds(instance.current.L.latLngBounds(points.map(c=>[c.lat,c.lon])),{padding:[26,26],maxZoom:13});
  },[fitRequest,ready]);
  return <div className={styles.mapShell}><div ref={host} className={styles.liveMap} role="region" aria-label="Interactive map of Toledo-area clients and one-mile neighborhood pockets"/>{!ready&&!error&&<p className={styles.mapStatus}>Loading the local map…</p>}{error&&<p role="alert" className={styles.warning}>{error}</p>}{tilesFailed&&<p role="status" className={styles.warning}>Street tiles are unavailable. Client locations and the pocket list remain available; try again later.</p>}</div>;
}
