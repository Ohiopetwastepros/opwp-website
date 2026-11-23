'use client';
import {useState} from 'react';
import FoodCustomerDialog from '@/components/FoodCustomerDialog';
import s from './sales-operations.module.css';
export function StaffCustomerSelect({customers,selected,onCreate}) {
  const [search,setSearch]=useState('');
  const rows=customers.filter(c=>[c.first_name,c.last_name,c.email,c.phone].join(' ').toLowerCase().includes(search.toLowerCase())||c.id===selected);
  return <div><label className={s.field}><span>Search saved customer accounts first</span><input type='search' value={search} onChange={e=>setSearch(e.target.value)} placeholder='Name, email or phone'/></label><label className={s.field}><span>Customer account</span><select name='customerId' required defaultValue={selected||''}><option value=''>Select a saved customer</option>{rows.map(c=><option key={c.id} value={c.id}>{c.first_name} {c.last_name} · {c.email}</option>)}</select></label><button type='button' onClick={onCreate}>Create customer account</button><p>No password is needed for a direct sale. Online access requires email verification.</p></div>;
}
export default function StaffCustomerDialog({onClose,onSaved}) {
  return <FoodCustomerDialog endpoint='/api/admin/dog-food/customers/' onClose={onClose} onSaved={customer=>onSaved(customer.id)}/>;
}
