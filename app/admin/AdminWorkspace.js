"use client";

import { useEffect, useRef, useState } from "react";
import { ADMIN_NAVIGATION } from "./admin-navigation.mjs";
import SignOutButton from "./route-partner/SignOutButton";
import styles from "./admin-navigation.module.css";

const NAV_GROUPS = [
  {id:'crm-dashboard',label:'Home',href:'/admin/crm/'},
  {id:'crm-customers',label:'Customers',href:'/admin/crm/customers/',items:[['crm-work-queue','Change requests','/admin/crm/work-queue/'],['crm-dog-food','Dog food','/admin/crm/dog-food/']]},
  {id:'crm-schedule',label:'Schedule',href:'/admin/crm/schedule/'},
  {id:'crm-routes',label:'Routes',href:'/admin/crm/routes/',items:[['crm-best-fit','Best fit','/admin/crm/best-fit/'],['crm-techs','Technicians','/admin/crm/techs/'],['crm-exceptions','Exceptions','/admin/crm/exceptions/']]},
  {id:'crm-billing',label:'Billing',href:'/admin/crm/billing/',items:[['crm-subscriptions','Subscriptions','/admin/crm/subscriptions/'],['crm-price-book','Price book','/admin/crm/subscriptions/?tab=book']]},
  {id:'crm-leads',label:'Leads',href:'/admin/crm/leads/'},
  {id:'crm-messages',label:'Messages',href:'/admin/crm/messages/',items:[['crm-eta','Arrival messages','/admin/crm/eta/']]},
  {id:'crm-analytics',label:'Reports',href:'/admin/crm/analytics/'},
  {id:'crm-settings',label:'Settings',href:'/admin/crm/settings/',items:[['crm-sync-issues','Sync issues','/admin/crm/sync-issues/']]},
];
const groupFor=section=>NAV_GROUPS.find(group=>group.id===section||group.items?.some(item=>item[0]===section))?.id;

export default function AdminWorkspace({ section, email, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [local, setLocal] = useState(false);
  const [activeSection, setActiveSection] = useState(section);
  const [expandedGroup,setExpandedGroup] = useState(groupFor(section));
  const [createOpen,setCreateOpen] = useState(false);
  const searchRef=useRef(null),createRef=useRef(null);
  useEffect(() => { setLocal(['localhost', '127.0.0.1'].includes(window.location.hostname)); const tab = new URLSearchParams(window.location.search).get('tab'); setActiveSection(section === 'crm-subscriptions' && tab === 'book' ? 'crm-price-book' : section); }, [section]);
  useEffect(()=>{function keydown(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchRef.current?.focus();searchRef.current?.select();}if(event.key==='Escape')setCreateOpen(false);}function outside(event){if(createRef.current&&!createRef.current.contains(event.target))setCreateOpen(false);}window.addEventListener('keydown',keydown);window.addEventListener('pointerdown',outside);return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('pointerdown',outside);};},[]);
  const itemLink = (item) => <a key={item.id} href={item.href} aria-current={activeSection === item.id ? "page" : undefined}>{item.label}</a>;
  return <div className={`${styles.frame} opwp-admin-shell`}>
    <a className={styles.skip} href="#admin-content">Skip to content</a>
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
      <a className={styles.brand} href="/admin/crm/"><span className={styles.brandMark}>O</span><span><strong>ROUTE OS<span className={styles.brandDot}>.</span></strong><small>Ohio Pet Waste Pros</small></span></a>
      <button type="button" className={styles.mobileToggle} aria-label={mobileOpen?'Close navigation':'Open navigation'} aria-expanded={mobileOpen} aria-controls="admin-menu" onClick={() => setMobileOpen(!mobileOpen)}><svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{mobileOpen?<path d="m5 5 10 10M15 5 5 15"/>:<path d="M3 5h14M3 10h14M3 15h14"/>}</svg><span>{mobileOpen?'Close':'Menu'}</span></button>
      </div>
      <div id="admin-menu" className={`${styles.menuBody} ${mobileOpen ? styles.menuOpen : ""}`}>
      <nav aria-label="Admin navigation">
        {NAV_GROUPS.map(group=><div key={group.id} className={styles.primaryGroup}><div className={`${styles.navRow} ${groupFor(activeSection)===group.id?styles.activeGroup:''}`}><a href={group.href} aria-current={activeSection===group.id?'page':undefined}>{group.label}</a>{group.items?<button className={styles.groupToggle} type="button" aria-label={`${expandedGroup===group.id?'Hide':'Show'} ${group.label.toLowerCase()} tools`} aria-expanded={expandedGroup===group.id} aria-controls={`nav-${group.id}`} onClick={()=>setExpandedGroup(expandedGroup===group.id?null:group.id)}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={expandedGroup===group.id?'m5 12 5-5 5 5':'m5 8 5 5 5-5'}/></svg></button>:null}</div>{group.items?<div id={`nav-${group.id}`} className={styles.subnav} hidden={expandedGroup!==group.id}>{group.items.map(([id,label,href])=>itemLink({id,label,href}))}{group.id==='crm-settings'?<details><summary>All OPWP tools</summary>{itemLink({id:'overview',label:'Executive overview',href:'/admin/'})}{ADMIN_NAVIGATION.map((group) => <details key={group.id}>
          <summary>{group.label}</summary>
          <div className={styles.links}>{group.items.map(itemLink)}</div>
        </details>)}</details>:null}</div>:null}</div>)}
      </nav>
      <div className={styles.account}><span>Signed in as</span><strong>{email || "OPWP administrator"}</strong><SignOutButton /></div>
      </div>
    </aside>
    <div id="admin-content" tabIndex={-1} className={styles.content}><div className={styles.topbar}><form action='/admin/crm/customers/' className={styles.globalSearch}><button type="submit" aria-label="Search customers"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></button><input ref={searchRef} type="search" aria-label='Global customer search' aria-keyshortcuts="Control+K Meta+K" name='q' value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search customers or addresses' /><kbd>Ctrl K</kbd></form><div className={styles.createWrap} ref={createRef}><button className={styles.createButton} type="button" aria-expanded={createOpen} aria-controls="create-options" onClick={()=>setCreateOpen(!createOpen)}>+ Create</button>{createOpen?<div id="create-options" className={styles.createMenu}><a href="/admin/crm/subscriptions/?create=customer#new-customer">Customer</a><a href="/admin/crm/subscriptions/">Subscription</a><a href="/admin/crm/billing/?create=invoice">Invoice</a><a href="/admin/call-guide/">Lead or quote</a><a href="/admin/crm/messages/">Message draft</a></div>:null}</div><div className={styles.topMeta}>{local ? <a href='/local-preview/mark-review/'>Review</a> : null}</div></div>{children}</div>
  </div>;
}
