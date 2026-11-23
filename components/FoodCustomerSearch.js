'use client';
import {useId,useState} from 'react';
import s from './food-customer-search.module.css';
export default function FoodCustomerSearch({value,onChange,customers=[],onSelect,loading=false}){
  const id=useId(),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
  const shown=open&&value.trim().length>0,items=loading?[]:customers.slice(0,20);
  return <div className={s.search} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setActive(-1);}}}>
    <label htmlFor={id}>Find a customer</label>
    <input id={id} type='search' role='combobox' autoComplete='off' aria-autocomplete='list' aria-expanded={shown} aria-controls={shown?id+'-results':undefined} aria-activedescendant={shown&&active>=0&&items[active]?id+'-'+active:undefined} placeholder='Start typing a name, phone or email' value={value}
      onFocus={()=>setOpen(true)} onChange={e=>{onChange(e.target.value);setActive(-1);setOpen(true);}}
      onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);setActive(-1);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(n=>items.length?(e.key==='ArrowDown'?(n+1)%items.length:(n<=0?items.length-1:n-1)):-1);}else if(e.key==='Enter'&&shown){e.preventDefault();if(items[active]){onSelect(items[active]);setOpen(false);setActive(-1);}}}}/>
    {shown&&<div className={s.dropdown}><div id={id+'-results'} role='listbox' aria-label='Matching customers' aria-busy={loading}>
      {items.map((c,i)=><button id={id+'-'+i} role='option' aria-selected={active===i} type='button' key={c.id} className={s.option} onMouseDown={e=>e.preventDefault()} onClick={()=>{onSelect(c);setOpen(false);setActive(-1);}}>
        <span className={s.avatar}>{(c.first_name?.[0]||'')+(c.last_name?.[0]||'')}</span><span><strong>{c.first_name} {c.last_name}</strong><span>{c.phone||'Phone not recorded'}</span><span>{c.email||'Email not recorded'}</span></span>{c.status&&c.status!=='active'&&<small>Inactive</small>}
      </button>)}
    </div>{loading?<p role='status'>Searching customers…</p>:!items.length?<p role='status'>No matching customers.</p>:<p>Use ↑ ↓ and Enter, or select a contact.</p>}</div>}
  </div>;
}
