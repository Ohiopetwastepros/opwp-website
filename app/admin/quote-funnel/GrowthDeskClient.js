"use client";

import { useMemo, useState } from "react";
import styles from "./growth-desk.module.css";

const STAGES = ["new", "contacted", "qualified", "quoted", "won", "lost"];
const PRIORITIES = ["normal", "high", "urgent"];
const OPWP_TIME_ZONE = "America/New_York";
const DISPLAY_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: OPWP_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const INPUT_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPWP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function label(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value) {
  if (!value) return "";
  const parsed = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") || /[+-]\d\d:?\d\d$/.test(value) ? "" : "Z"));
  return Number.isFinite(parsed.getTime()) ? DISPLAY_DATE_TIME.format(parsed) : String(value);
}

function localInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(INPUT_DATE_TIME.formatToParts(date).map(({ type, value: partValue }) => [type, partValue]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function money(value) {
  return value === null ? "Not captured" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function priorityClass(priority) {
  return priority === "urgent" ? `${styles.pill} ${styles.pillUrgent}` : priority === "high" ? `${styles.pill} ${styles.pillHigh}` : styles.pill;
}

function deliveryLabel(channel) {
  return ({ sng_lead: "Sweep & Go partial lead", customer_sms: "Customer SMS", customer_email: "Customer email" })[channel] || label(channel);
}

function openQuoText(event, phone) {
  if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
  event.preventDefault();
  window.location.href = `openphone://message?number=${encodeURIComponent(phone)}&from=${encodeURIComponent("+14192622371")}&selectedAsFallback=true`;
}

function Fact({ name, value }) {
  return <div className={styles.fact}><span>{name}</span><strong title={String(value || "")}>{value || "—"}</strong></div>;
}

export default function GrowthDeskClient({ initialLeads, currentAdmin }) {
  const [leads, setLeads] = useState(initialLeads);
  const [selectedId, setSelectedId] = useState(initialLeads[0]?.id || "");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("open");
  const [status, setStatus] = useState({ message: "", error: false });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const selected = leads.find((lead) => lead.id === selectedId) || leads[0] || null;
  const [drafts, setDrafts] = useState({});
  const draft = selected ? drafts[selected.id] || {
    stage: selected.stage,
    priority: selected.priority,
    owner: selected.owner ? "me" : "unassigned",
    nextAction: selected.nextAction,
    nextActionAt: localInput(selected.nextActionAt),
  } : null;
  const updateDraft = (field, value) => setDrafts((current) => ({ ...current, [selected.id]: { ...draft, [field]: value } }));

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return leads.filter((lead) => {
      const stageMatches = stageFilter === "all" || (stageFilter === "open" ? !["won", "lost"].includes(lead.stage) : lead.stage === stageFilter);
      const searchMatches = !search || [lead.name, lead.email, lead.phone, lead.zip, lead.nextAction].some((value) => String(value || "").toLowerCase().includes(search));
      return stageMatches && searchMatches;
    });
  }, [leads, query, stageFilter]);

  async function mutate(body) {
    setSaving(true);
    setStatus({ message: "", error: false });
    try {
      const response = await fetch(`/api/admin/growth-desk/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The YardOps Pipeline update failed.");
      return result;
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "The YardOps Pipeline update failed.", error: true });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveState() {
    const result = await mutate({ action: "save_state", ...draft, nextActionAt: draft.nextActionAt ? new Date(draft.nextActionAt).toISOString() : "" });
    if (!result) return;
    const { event, ...state } = result.state;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, ...state, events: [event, ...lead.events] } : lead));
    setDrafts((current) => { const next = { ...current }; delete next[selected.id]; return next; });
    setStatus({ message: "Workflow saved. The quote and onboarding records were not changed.", error: false });
  }

  async function addNote() {
    const result = await mutate({ action: "add_note", note });
    if (!result) return;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, events: [result.event, ...lead.events] } : lead));
    setNote("");
    setStatus({ message: "Note added to the audit timeline.", error: false });
  }

  const counts = {
    open: leads.filter((lead) => !["won", "lost"].includes(lead.stage)).length,
    new: leads.filter((lead) => lead.stage === "new").length,
    quoted: leads.filter((lead) => lead.stage === "quoted").length,
    won: leads.filter((lead) => lead.stage === "won").length,
    attention: leads.filter((lead) => lead.sourceStatus === "needs_attention" || [...lead.deliveries, ...lead.notifications].some((item) => item.status === "failed")).length,
  };

  return <>
    <section className={styles.metrics}>
      {[["Open opportunities", counts.open], ["New", counts.new], ["Quoted", counts.quoted], ["Won / converted", counts.won], ["Needs attention", counts.attention]].map(([name, value]) => <article className={styles.metric} key={name}><span>{name}</span><strong>{value}</strong></article>)}
    </section>
    <div className={styles.toolbar}>
      <input aria-label="Search leads" placeholder="Search name, email, phone, ZIP, or next action" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Filter by stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
        <option value="open">Open stages</option><option value="all">All stages</option>
        {STAGES.map((stage) => <option value={stage} key={stage}>{label(stage)}</option>)}
      </select>
      <span className={styles.resultCount}>{filtered.length} of {leads.length} records</span>
    </div>
    <section className={styles.desk}>
      <div className={styles.leadList} aria-label="YardOps Pipeline lead list">
        {filtered.length ? filtered.map((lead) => <button type="button" className={`${styles.leadButton} ${lead.id === selected?.id ? styles.leadActive : ""}`} onClick={() => { setSelectedId(lead.id); setStatus({ message: "", error: false }); }} key={lead.id}>
          <div className={styles.leadTop}><strong>{lead.name}</strong><span className={priorityClass(lead.priority)}>{lead.stage}</span></div>
          <div className={styles.leadMeta}><span>{lead.zip || label(lead.kind)}</span><span>{dateTime(lead.activityAt)}</span></div>
          <div className={styles.leadAction}>{lead.nextAction ? `${dateTime(lead.nextActionAt)} · ${lead.nextAction}` : "No office next action scheduled"}</div>
        </button>) : <div className={styles.empty}>No leads match these filters.</div>}
      </div>
      {selected ? <article className={styles.panel}>
        <header className={styles.detailHead}>
          <div><h2>{selected.name}</h2><p>{label(selected.kind)} · {selected.zip || "ZIP pending"} · captured {dateTime(selected.createdAt)}</p></div>
          <div className={styles.contactActions}>
            {selected.phone ? <a href={`tel:${selected.phone}`}>Call</a> : null}
            {selected.phone ? <a href="https://my.quo.com/" target="_blank" rel="noreferrer" onClick={(event) => openQuoText(event, selected.phone)} title="Open Quo to text this lead">Text</a> : null}
            {selected.email ? <a href={`mailto:${selected.email}`}>Email</a> : null}
          </div>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h3>Lead and quote context</h3><span>Read-only source data</span></div>
          <div className={styles.facts}>
            <Fact name="Monthly quote" value={money(selected.quote.monthly)} /><Fact name="Frequency" value={label(selected.quote.frequency)} />
            <Fact name="Dogs" value={selected.quote.dogs} /><Fact name="Yard" value={label(selected.quote.yard)} />
            <Fact name="Phone" value={selected.phone} /><Fact name="Email" value={selected.email} />
            <Fact name="SMS consent" value={selected.quote.consent ? `Recorded ${dateTime(selected.quote.consentAt)}` : "Not recorded"} />
            <Fact name="Sweep & Go" value={`${label(selected.sng.state)}${selected.sng.id ? ` · ${selected.sng.id}` : ""}`} />
          </div>
          {selected.quote.question ? <div className={styles.question}><strong>Customer question:</strong> {selected.quote.question}</div> : null}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h3>Office workflow</h3><span>Separate from the public quote state</span></div>
          <div className={styles.formGrid}>
            <div className={styles.field}><label htmlFor="growth-stage">Stage</label><select id="growth-stage" value={draft.stage} disabled={selected.stageLocked} onChange={(event) => updateDraft("stage", event.target.value)}>{STAGES.map((stage) => <option value={stage} key={stage}>{label(stage)}</option>)}</select></div>
            <div className={styles.field}><label htmlFor="growth-priority">Priority</label><select id="growth-priority" value={draft.priority} onChange={(event) => updateDraft("priority", event.target.value)}>{PRIORITIES.map((priority) => <option value={priority} key={priority}>{label(priority)}</option>)}</select></div>
            <div className={styles.field}><label htmlFor="growth-owner">Owner</label><select id="growth-owner" value={draft.owner} onChange={(event) => updateDraft("owner", event.target.value)}><option value="me">Me · {currentAdmin}</option><option value="unassigned">Unassigned</option></select></div>
            <div className={styles.field}><label htmlFor="growth-due">Next action due</label><input id="growth-due" type="datetime-local" value={draft.nextActionAt} onChange={(event) => updateDraft("nextActionAt", event.target.value)} /></div>
            <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="growth-action">Next action</label><input id="growth-action" maxLength={240} placeholder="Example: Call about weekly service and answer the gate question" value={draft.nextAction} onChange={(event) => updateDraft("nextAction", event.target.value)} /></div>
          </div>
          <div className={styles.formActions}><button className={styles.button} type="button" disabled={saving} onClick={saveState}>Save workflow</button></div>
          <div className={`${styles.status} ${status.error ? styles.statusError : ""}`} role="status">{status.message}</div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h3>Recovery delivery</h3><span>Existing ten-minute workflow</span></div>
          <div className={styles.deliveryList}>
            {selected.deliveries.length ? selected.deliveries.map((delivery) => <div className={styles.deliveryRow} key={delivery.channel}><strong>{deliveryLabel(delivery.channel)}</strong><span>{label(delivery.status)}{delivery.sent_at ? ` · ${dateTime(delivery.sent_at)}` : ""}{delivery.attempt_count ? ` · ${delivery.attempt_count} attempt(s)` : ""}</span></div>) : <div className={styles.empty}>No customer recovery was queued for this record.</div>}
            {selected.notifications.map((item) => <div className={styles.deliveryRow} key={`${item.notification_type}-${item.channel}`}><strong>Owner {label(item.notification_type)}</strong><span>{label(item.status)}{item.sent_at ? ` · ${dateTime(item.sent_at)}` : ""}</span></div>)}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h3>Notes and timeline</h3><span>Audited by signed-in admin</span></div>
          <div className={styles.noteBox}><textarea maxLength={2000} placeholder="Record the call outcome, objection, requested timing, or handoff context." value={note} onChange={(event) => setNote(event.target.value)} /><div className={styles.formActions}><button className={styles.button} type="button" disabled={saving || !note.trim()} onClick={addNote}>Add note</button></div></div>
          <div className={styles.timeline}>
            {selected.events.map((event) => <div className={styles.timelineItem} key={event.id}><div><strong>{event.summary}</strong><small>{label(event.event_type)} · {event.actor_email}</small></div><small>{dateTime(event.created_at)}</small></div>)}
            <div className={styles.timelineItem}><div><strong>{selected.stageLocked ? "Customer conversion recorded" : "Website lead captured"}</strong><small>System source event</small></div><small>{dateTime(selected.activityAt)}</small></div>
          </div>
        </section>
      </article> : <div className={styles.panel}><div className={styles.empty}>No YardOps Pipeline records are available yet.</div></div>}
    </section>
  </>;
}
