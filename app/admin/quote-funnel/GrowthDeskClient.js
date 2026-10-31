"use client";

import { useMemo, useState } from "react";
import { findAnswerMatch } from "@/lib/lead-assistant.mjs";
import { buildLeadAnalytics, GROWTH_LOSS_REASONS, GROWTH_NOT_QUALIFIED_REASONS, leadSourceBucket } from "@/lib/growth-desk.mjs";
import { allowedOperationalDays } from "@/lib/route-day-policy.mjs";
import styles from "./growth-desk.module.css";
import MetaLeadPanel from "./MetaLeadPanel";

const STAGES = ["new", "contacted", "qualified", "quoted", "won", "lost", "not_qualified"];
const PRIORITIES = ["normal", "high", "urgent"];
const SOURCE_TABS = [["all", "All leads"], ["meta", "Meta leads"], ["quo", "Quo text leads"], ["website_quotes", "Website partial quotes"], ["other", "Other"]];
const SOURCE_NAMES = { meta: "Meta", quo: "Quo", website_quotes: "Website quote", other: "Other" };
const ANALYTICS_RANGES = [[30, "Last 30 days"], [90, "Last 90 days"], [365, "Last 12 months"], [0, "All time"]];
const OPWP_TIME_ZONE = "America/New_York";
const DISPLAY_DATE_TIME = new Intl.DateTimeFormat("en-US", { timeZone: OPWP_TIME_ZONE, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const INPUT_DATE_TIME = new Intl.DateTimeFormat("en-CA", { timeZone: OPWP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function label(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function dateTime(value) {
  if (!value) return "—";
  const source = String(value);
  const parsed = new Date(source.replace(" ", "T") + (source.includes("Z") || /[+-]\d\d:?\d\d$/.test(source) ? "" : "Z"));
  return Number.isFinite(parsed.getTime()) ? DISPLAY_DATE_TIME.format(parsed) : source;
}
function localInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(INPUT_DATE_TIME.formatToParts(date).map(({ type, value: item }) => [type, item]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function money(value) { return value === null || value === undefined ? "Not captured" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function percent(value) { return value === null ? "Needs outcomes" : `${value}%`; }
function deliveryLabel(channel) { return ({ sng_lead: "Sweep & Go partial lead", customer_sms: "Customer SMS", customer_email: "Customer email" })[channel] || label(channel); }
function priorityClass(priority) { return priority === "urgent" ? `${styles.pill} ${styles.pillUrgent}` : priority === "high" ? `${styles.pill} ${styles.pillHigh}` : styles.pill; }
function openQuoText(event, phone) {
  if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
  event.preventDefault();
  window.location.href = `openphone://message?number=${encodeURIComponent(phone)}&from=${encodeURIComponent("+14192622371")}&selectedAsFallback=true`;
}
function Fact({ name, value }) { return <div className={styles.fact}><span>{name}</span><strong title={String(value || "")}>{value || "—"}</strong></div>; }
function openLead(lead) { return !["won", "lost", "not_qualified"].includes(lead.stage); }
function isOverdue(lead, now = Date.now()) { const due = Date.parse(lead.nextActionAt || ""); return openLead(lead) && Number.isFinite(due) && due < now; }
function matchedAnswer(lead, answers) {
  const latestInbound = [...(lead?.conversation?.messages || [])].reverse().find((item) => item.direction === "inbound")?.body;
  return findAnswerMatch(latestInbound || lead?.quote?.question, answers);
}
function suggestedReply(lead, answers) {
  const match = matchedAnswer(lead, answers);
  if (!match) return "";
  if (match.response_mode === "pricing" && lead.quote.monthly !== null) return `Thanks for reaching out to Ohio Pet Waste Pros. Your saved quote is ${money(lead.quote.monthly)} per month for ${label(lead.quote.frequency).toLowerCase()} service. What questions can I answer before you get started?`;
  if (match.response_mode === "service_day") {
    const days = allowedOperationalDays({ city: "", zip: lead.zip, frequency: label(lead.quote.frequency) });
    if (days.length === 1) return `Your current OPWP route option is ${days[0]}. The final service day is confirmed when you finish signup.`;
  }
  return match.answer_template;
}

export default function GrowthDeskClient({ initialLeads, initialAnswers = [], assistantSettings = null, initialHealth = null, currentAdmin }) {
  const [leads, setLeads] = useState(initialLeads);
  const [answers, setAnswers] = useState(initialAnswers);
  const [settings, setSettings] = useState({ assistantEnabled: Boolean(assistantSettings?.assistant_enabled), quietHoursEnabled: assistantSettings?.quiet_hours_enabled !== 0, quietHoursStart: assistantSettings?.quiet_hours_start || "20:00", quietHoursEnd: assistantSettings?.quiet_hours_end || "08:00", maxFollowUpTouches: Number(assistantSettings?.max_follow_up_touches ?? 3), humanReviewRequired: assistantSettings?.human_review_required !== 0 });
  const [tab, setTab] = useState("pipeline");
  const [sourceTab, setSourceTab] = useState("all");
  const [selectedId, setSelectedId] = useState(initialLeads[0]?.id || "");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("open");
  const [quickFilter, setQuickFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [analyticsRange, setAnalyticsRange] = useState(90);
  const [status, setStatus] = useState({ message: "", error: false });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState(() => suggestedReply(initialLeads[0], initialAnswers));
  const [followUpAt, setFollowUpAt] = useState(localInput(new Date(Date.now() + 86400000).toISOString()));
  const emptyAnswer = { answerKey: "", category: "Service", question: "", answer: "", keywords: "", responseMode: "static", autoSendAllowed: false };
  const [answerDraft, setAnswerDraft] = useState(emptyAnswer);
  const [drafts, setDrafts] = useState({});
  const [loadedAt] = useState(() => new Date().toISOString());

  const sourceLeads = useMemo(() => sourceTab === "all" ? leads : leads.filter((lead) => leadSourceBucket(lead) === sourceTab), [leads, sourceTab]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return sourceLeads.filter((lead) => {
      const stageMatches = stageFilter === "all" || (stageFilter === "open" ? openLead(lead) : lead.stage === stageFilter);
      const quickMatches = quickFilter === "all"
        || (quickFilter === "unread" && Number(lead.conversation?.unreadCount || 0) > 0)
        || (quickFilter === "queued" && (lead.followUps || []).some((job) => job.status === "queued"))
        || (quickFilter === "overdue" && isOverdue(lead))
        || (quickFilter === "unassigned" && openLead(lead) && !lead.owner)
        || (quickFilter === "untouched" && openLead(lead) && lead.stage === "new" && !lead.conversation?.lastOutboundAt);
      const outcomeMatches = !outcomeFilter || lead.outcomeReason === outcomeFilter;
      const searchMatches = !search || [lead.name, lead.email, lead.phone, lead.zip, lead.nextAction, lead.outcomeNote, lead.outcomeReason].some((value) => String(value || "").toLowerCase().includes(search));
      return stageMatches && quickMatches && outcomeMatches && searchMatches;
    });
  }, [sourceLeads, query, stageFilter, quickFilter, outcomeFilter]);
  const selected = filtered.find((lead) => lead.id === selectedId) || filtered[0] || null;
  const draft = selected ? drafts[selected.id] || { stage: selected.stage, priority: selected.priority, owner: selected.owner ? "me" : "unassigned", nextAction: selected.nextAction, nextActionAt: localInput(selected.nextActionAt), outcomeReason: selected.outcomeReason || "", outcomeNote: selected.outcomeNote || "" } : null;
  const updateDraft = (field, value) => setDrafts((current) => ({ ...current, [selected.id]: { ...draft, [field]: value } }));
  const updateStage = (stage) => setDrafts((current) => ({ ...current, [selected.id]: { ...draft, stage, outcomeReason: stage === draft.stage ? draft.outcomeReason : "" } }));
  const analyticsLeads = useMemo(() => analyticsRange === 0 ? leads : leads.filter((lead) => {
    const captured = Date.parse(lead.createdAt || "");
    return Number.isFinite(captured) && captured >= Date.now() - analyticsRange * 86400000;
  }), [leads, analyticsRange]);
  const analytics = useMemo(() => buildLeadAnalytics(analyticsLeads), [analyticsLeads]);
  const analyticsActions = useMemo(() => ({
    overdue: analyticsLeads.filter((lead) => isOverdue(lead)).length,
    unread: analyticsLeads.filter((lead) => Number(lead.conversation?.unreadCount || 0) > 0).length,
    unassigned: analyticsLeads.filter((lead) => openLead(lead) && !lead.owner).length,
    untouched: analyticsLeads.filter((lead) => openLead(lead) && lead.stage === "new" && !lead.conversation?.lastOutboundAt).length,
  }), [analyticsLeads]);
  const selectedMatch = selected ? matchedAnswer(selected, answers) : null;
  const counts = {
    open: sourceLeads.filter(openLead).length,
    new: sourceLeads.filter((lead) => lead.stage === "new").length,
    unread: sourceLeads.filter((lead) => Number(lead.conversation?.unreadCount || 0) > 0).length,
    queued: sourceLeads.filter((lead) => (lead.followUps || []).some((job) => job.status === "queued")).length,
    won: sourceLeads.filter((lead) => lead.stage === "won").length,
    lost: sourceLeads.filter((lead) => lead.stage === "lost").length,
    notQualified: sourceLeads.filter((lead) => lead.stage === "not_qualified").length,
    overdue: sourceLeads.filter((lead) => isOverdue(lead)).length,
    unassigned: sourceLeads.filter((lead) => openLead(lead) && !lead.owner).length,
    untouched: sourceLeads.filter((lead) => openLead(lead) && lead.stage === "new" && !lead.conversation?.lastOutboundAt).length,
  };

  async function request(url, method, body) {
    setSaving(true); setStatus({ message: "", error: false });
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The YardOps update failed.");
      return result;
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "The YardOps update failed.", error: true });
      return null;
    } finally { setSaving(false); }
  }
  const mutate = (body) => request(`/api/admin/growth-desk/${selected.id}`, "PATCH", body);
  function openPipeline(stage = "all", quick = "all", leadId = "", lossReason = "", source = "all") {
    setTab("pipeline"); setSourceTab(source); setStageFilter(stage); setQuickFilter(quick); setOutcomeFilter(lossReason); setQuery("");
    const match = leadId ? leads.find((lead) => lead.id === leadId) : leads.find((lead) => {
      if (source !== "all" && leadSourceBucket(lead) !== source) return false;
      if (stage === "open") return openLead(lead);
      if (stage !== "all" && lead.stage !== stage) return false;
      if (quick === "unread") return Number(lead.conversation?.unreadCount || 0) > 0;
      if (quick === "queued") return (lead.followUps || []).some((job) => job.status === "queued");
      if (quick === "overdue") return isOverdue(lead);
      if (quick === "unassigned") return openLead(lead) && !lead.owner;
      if (quick === "untouched") return openLead(lead) && lead.stage === "new" && !lead.conversation?.lastOutboundAt;
      if (lossReason) return lead.outcomeReason === lossReason;
      return true;
    });
    setSelectedId(match?.id || ""); setMessage(match ? suggestedReply(match, answers) : "");
  }
  async function saveState() {
    const result = await mutate({ action: "save_state", ...draft, outcomeReason: ["lost", "not_qualified"].includes(draft.stage) ? draft.outcomeReason : "", nextActionAt: draft.nextActionAt ? new Date(draft.nextActionAt).toISOString() : "" });
    if (!result) return;
    const { event, ...state } = result.state;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, ...state, events: [event, ...lead.events] } : lead));
    setDrafts((current) => { const next = { ...current }; delete next[selected.id]; return next; });
    setStatus({ message: "Workflow and outcome saved. Airtable sync is queued; public quote data was not changed.", error: false });
  }
  async function addNote() {
    const result = await mutate({ action: "add_note", note });
    if (!result) return;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, events: [result.event, ...lead.events] } : lead));
    setNote(""); setStatus({ message: "Note added to the audit timeline.", error: false });
  }
  async function sendMessage() {
    const result = await mutate({ action: "send_message", message });
    if (!result) return;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, conversation: { ...lead.conversation, status: "waiting", messages: [...(lead.conversation?.messages || []), result.message] } } : lead));
    setMessage(""); setStatus({ message: "Text sent through the OPWP Quo number and recorded here.", error: false });
  }
  async function setAutomation(mode) {
    const result = await mutate({ action: "set_automation", mode });
    if (!result) return;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, conversation: { ...lead.conversation, automationMode: mode } } : lead));
    setStatus({ message: `This lead is now in ${label(mode)} mode.`, error: false });
  }
  async function scheduleFollowUp() {
    if (!followUpAt) return setStatus({ message: "Choose a follow-up time.", error: true });
    const result = await mutate({ action: "schedule_follow_up", message, dueAt: new Date(followUpAt).toISOString() });
    if (!result) return;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, followUps: [...(lead.followUps || []), result.job] } : lead));
    setMessage(""); setStatus({ message: settings.humanReviewRequired ? "Follow-up saved for review; it will not auto-send while human review is required." : "Follow-up scheduled.", error: false });
  }
  async function cancelFollowUps() {
    const result = await mutate({ action: "cancel_follow_ups" });
    if (!result) return;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, followUps: (lead.followUps || []).map((job) => ["queued", "failed"].includes(job.status) ? { ...job, status: "cancelled" } : job) } : lead));
    setStatus({ message: "Pending follow-ups cancelled.", error: false });
  }
  async function startNurture() {
    const result = await mutate({ action: "start_nurture" });
    if (!result) return;
    setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, followUps: result.jobs } : lead));
    setStatus({ message: "The OPWP 1-day, 3-day, and 7-day sequence is prepared. Delivery still follows every safety control.", error: false });
  }
  async function deleteSelectedLead() {
    if (!window.confirm(`Delete ${selected.name} from active YardOps? Contact details and messages will be removed, pending texts cancelled, and a minimal audit tombstone kept.`)) return;
    const reason = window.prompt("Why is this lead being deleted?", "Not a relevant lead");
    if (!reason) return;
    const result = await mutate({ action: "delete_lead", reason });
    if (!result) return;
    const remaining = leads.filter((lead) => lead.id !== selected.id);
    setLeads(remaining); setSelectedId(remaining[0]?.id || "");
    setStatus({ message: "Lead deleted from active YardOps. Airtable will retain only a redacted deletion marker.", error: false });
  }
  async function saveSettings() {
    const result = await request("/api/admin/yardops/settings", "PATCH", settings);
    if (result) setStatus({ message: "Lead assistant controls saved.", error: false });
  }
  async function saveAnswer() {
    const body = { ...answerDraft, keywords: answerDraft.keywords.split(",").map((item) => item.trim()).filter(Boolean) };
    const result = await request("/api/admin/yardops/answers", "PUT", body);
    if (!result) return;
    setAnswers((current) => [...current.filter((item) => item.answer_key !== result.entry.answer_key), result.entry].sort((a, b) => `${a.category}${a.question}`.localeCompare(`${b.category}${b.question}`)));
    setAnswerDraft(emptyAnswer); setStatus({ message: "Approved answer saved to the OPWP playbook.", error: false });
  }

  const metricItems = [
    ["Open leads", counts.open, "open", "all", "Active opportunities"],
    ["New", counts.new, "new", "all", "Needs first touch"],
    ["Unread", counts.unread, "all", "unread", "Customer replied"],
    ["Follow-ups", counts.queued, "all", "queued", "Queued or in review"],
    ["Won", counts.won, "won", "all", "Converted customers"],
    ["Lost", counts.lost, "lost", "all", "Closed with reason"],
    ["Not qualified", counts.notQualified, "not_qualified", "all", "No response or opted out"],
  ];
  const healthItems = [
    { key: "website_quotes", name: "Website funnel", state: "Ready", detail: initialHealth?.website?.latestReceived ? `Last lead ${dateTime(initialHealth.website.latestReceived)}` : "Waiting for the next quote" },
    { key: "meta", name: "Meta lead ads", state: initialHealth?.meta?.latest_processed ? "Connected" : "Awaiting test", detail: initialHealth?.meta?.latest_received ? `Last event ${dateTime(initialHealth.meta.latest_received)}` : "No lead event received yet" },
    { key: "quo", name: "Quo lead texts", state: initialHealth?.quo?.latest_processed ? "Connected" : "Awaiting test", detail: initialHealth?.quo?.latest_received ? `Last event ${dateTime(initialHealth.quo.latest_received)}` : "No lead event received yet" },
    { key: "airtable", name: "Airtable leads", state: initialHealth?.airtable?.failed ? "Needs attention" : initialHealth?.airtable?.latestSynced ? "Synced" : "Ready", detail: initialHealth?.airtable?.failed ? `${initialHealth.airtable.failed} sync failures` : initialHealth?.airtable?.latestSynced ? `Last sync ${dateTime(initialHealth.airtable.latestSynced)}` : "Queue is ready" },
  ];

  return <>
    <div className={styles.productBar}>
      <div className={styles.productNav} role="tablist" aria-label="YardOps sections">
        {[["pipeline", "Lead desk"], ["analytics", "Analytics"], ["playbook", `Answer playbook (${answers.length})`], ["controls", "Automation controls"]].map(([value, name]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? styles.productNavActive : ""} onClick={() => setTab(value)}>{name}</button>)}
      </div>
      <div className={styles.productActions}><div className={styles.liveStatus}><span /> Live lead workspace</div><div className={styles.automationBadge}>{settings.assistantEnabled && !settings.humanReviewRequired ? "Approved automation active" : "Human review required"}</div><small>Loaded {dateTime(loadedAt)}</small><button type="button" onClick={() => window.location.reload()}>Refresh data</button></div>
    </div>
    <div className={`${styles.statusBanner} ${status.error ? styles.statusBannerError : ""}`} role="status">{status.message || "Private OPWP workspace · Source records remain traceable · Airtable sync runs in the background"}</div>
    <section className={styles.connectionRail} aria-label="Lead channel status">{healthItems.map((item) => item.key === "airtable"
      ? <a href="/admin/system-health/" key={item.key}><span className={styles.connectionIcon}>A</span><div><small>{item.name}</small><strong>{item.state}</strong><em>{item.detail}</em></div><b>View →</b></a>
      : <button type="button" key={item.key} onClick={() => openPipeline("all", "all", "", "", item.key)}><span className={styles.connectionIcon}>{item.key === "meta" ? "M" : item.key === "quo" ? "Q" : "W"}</span><div><small>{item.name}</small><strong>{item.state}</strong><em>{item.detail}</em></div><b>Open →</b></button>)}</section>

    {tab === "analytics" ? <section className={styles.analyticsWorkspace}>
      <div className={styles.analyticsIntro}><div><span className={styles.kicker}>Lead intelligence</span><h2>Conversion command center</h2><p>Every active YardOps lead, outcome, source, and quoted opportunity in one auditable view.</p></div><div className={styles.analyticsControls}><label htmlFor="analytics-range">Reporting period</label><select id="analytics-range" value={analyticsRange} onChange={(event) => setAnalyticsRange(Number(event.target.value))}>{ANALYTICS_RANGES.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select><button type="button" className={styles.buttonSecondary} onClick={() => openPipeline("all")}>Open lead desk</button></div></div>
      <div className={styles.analyticsKpis}>
        <button type="button" onClick={() => openPipeline("all")}><span>Total leads</span><strong>{analytics.total}</strong><small>All active source records</small></button>
        <button type="button" onClick={() => openPipeline("won")}><span>Won</span><strong>{analytics.won}</strong><small>{money(analytics.wonMonthly)} quoted monthly value</small></button>
        <button type="button" onClick={() => openPipeline("lost")}><span>Lost</span><strong>{analytics.lost}</strong><small>Outcome reason required</small></button>
        <button type="button" onClick={() => openPipeline("not_qualified")}><span>Not qualified</span><strong>{analytics.notQualified}</strong><small>No response or opted out</small></button>
        <button type="button" onClick={() => openPipeline("open")}><span>Open pipeline</span><strong>{analytics.open}</strong><small>{money(analytics.openQuotedMonthly)} quoted monthly value</small></button>
        <button type="button" onClick={() => openPipeline("all")}><span>Close rate</span><strong>{percent(analytics.conversionRate)}</strong><small>Won ÷ decided leads</small></button>
      </div>
      <div className={styles.analyticsGrid}>
        <article className={styles.analyticsCard}><div className={styles.cardHead}><div><span>Acquisition</span><h3>Performance by source</h3></div><small>Click a row to inspect</small></div><div className={styles.sourceTable}>
          <div className={styles.tableHeader}><span>Source</span><span>Leads</span><span>Won</span><span>Lost</span><span>Not qualified</span><span>Close rate</span></div>
          {analytics.sources.map((item) => <button type="button" key={item.source} onClick={() => openPipeline("all", "all", "", "", item.source)}><strong>{SOURCE_NAMES[item.source]}</strong><span>{item.total}</span><span>{item.won}</span><span>{item.lost}</span><span>{item.notQualified}</span><span>{percent(item.conversionRate)}</span></button>)}
        </div></article>
        <article className={styles.analyticsCard}><h3>Delivery and replies by source</h3><p>Counts within the loaded lead cohort and selected period.</p>{analytics.sources.map((item) => <p key={item.source}><strong>{SOURCE_NAMES[item.source]}:</strong> {item.delivered} delivered ? {item.deliveryErrors} delivery issues ? {item.replied} replied ? {item.qualified} qualified ? {item.quoted} quoted</p>)}</article>
        <article className={styles.analyticsCard}><div className={styles.cardHead}><div><span>Outcome intelligence</span><h3>Why opportunities are lost</h3></div><small>{analytics.lost} closed-lost</small></div>
          {analytics.lossReasons.length ? <div className={styles.reasonBars}>{analytics.lossReasons.map((item) => <button type="button" key={item.reason} onClick={() => openPipeline("lost", "all", "", item.reason)}><div><strong>{item.label}</strong><span>{item.count}</span></div><i style={{ width: `${Math.max(8, Math.round((item.count / analytics.lost) * 100))}%` }} /></button>)}</div> : <div className={styles.insightEmpty}><strong>No loss reasons recorded yet.</strong><p>When a lead is marked Lost, YardOps requires the reason so this report becomes actionable.</p></div>}
        </article>
      </div>
      <article className={styles.analyticsCard}><div className={styles.cardHead}><div><span>Lead qualification</span><h3>Why leads were not qualified</h3></div><small>{analytics.notQualified} not qualified</small></div>
        {analytics.notQualifiedReasons.length ? <div className={styles.reasonBars}>{analytics.notQualifiedReasons.map((item) => <button type="button" key={item.reason} onClick={() => openPipeline("not_qualified", "all", "", item.reason)}><div><strong>{item.label}</strong><span>{item.count}</span></div><i style={{ width: `${Math.max(8, Math.round((item.count / analytics.notQualified) * 100))}%` }} /></button>)}</div> : <div className={styles.insightEmpty}><strong>No unqualified leads recorded yet.</strong><p>Opt-outs appear here immediately. No-response leads appear only after the final approved follow-up and grace period.</p></div>}
      </article>
      <div className={styles.analyticsGrid}>
        <article className={styles.analyticsCard}><div className={styles.cardHead}><div><span>Pipeline shape</span><h3>Stage distribution</h3></div><small>{analytics.total} active records</small></div><div className={styles.stageFlow}>{STAGES.map((stage) => { const count = analyticsLeads.filter((lead) => lead.stage === stage).length; return <button type="button" key={stage} onClick={() => openPipeline(stage)}><span>{label(stage)}</span><strong>{count}</strong><i style={{ width: `${analytics.total ? Math.max(5, Math.round((count / analytics.total) * 100)) : 0}%` }} /></button>; })}</div></article>
        <article className={styles.analyticsCard}><div className={styles.cardHead}><div><span>Execution</span><h3>Follow-up discipline</h3></div><small>Click to work the queue</small></div><div className={styles.actionGrid}><button type="button" onClick={() => openPipeline("all", "overdue")}><strong>{analyticsActions.overdue}</strong><span>Overdue</span></button><button type="button" onClick={() => openPipeline("all", "unread")}><strong>{analyticsActions.unread}</strong><span>Unread</span></button><button type="button" onClick={() => openPipeline("all", "untouched")}><strong>{analyticsActions.untouched}</strong><span>Untouched</span></button><button type="button" onClick={() => openPipeline("all", "unassigned")}><strong>{analyticsActions.unassigned}</strong><span>Unassigned</span></button></div></article>
      </div>
      <article className={styles.analyticsCard}><div className={styles.cardHead}><div><span>Full ledger</span><h3>Lead outcome register</h3></div><small>{analyticsLeads.length} records in this period</small></div><div className={styles.ledgerWrap}>{analyticsLeads.length ? <table className={styles.ledger}><thead><tr><th>Lead</th><th>Source</th><th>Captured</th><th>Quote</th><th>Stage</th><th>Outcome reason</th><th /></tr></thead><tbody>{analyticsLeads.map((lead) => <tr key={lead.id}><td><strong>{lead.name}</strong><small>{lead.zip || "ZIP pending"}</small></td><td>{SOURCE_NAMES[leadSourceBucket(lead)]}</td><td>{dateTime(lead.createdAt)}</td><td>{money(lead.quote?.monthly)}</td><td><span className={styles.stageTag}>{label(lead.stage)}</span></td><td>{["lost", "not_qualified"].includes(lead.stage) ? label(lead.outcomeReason) || "Reason needed" : lead.stage === "won" ? "Converted" : "Open"}</td><td><button type="button" onClick={() => openPipeline("all", "all", lead.id)}>View lead</button></td></tr>)}</tbody></table> : <div className={styles.insightEmpty}><strong>No lead outcomes in this reporting period.</strong><p>New website, Meta, and Quo leads will populate this register automatically.</p></div>}</div></article>
    </section> : null}

    {tab === "controls" ? <section className={styles.settingsGrid}>
      <article className={styles.panel}><div className={styles.sectionHead}><h2>Automation safety</h2><span>Global controls</span></div>
        <label className={styles.toggleRow}><input type="checkbox" checked={settings.assistantEnabled} onChange={(event) => setSettings({ ...settings, assistantEnabled: event.target.checked })} /><span><strong>Enable approved automation</strong><small>Only conversations individually set to Approved can send.</small></span></label>
        <label className={styles.toggleRow}><input type="checkbox" checked={settings.humanReviewRequired} onChange={(event) => setSettings({ ...settings, humanReviewRequired: event.target.checked })} /><span><strong>Require human review</strong><small>Keep enabled while the playbook and channel connections are verified.</small></span></label>
        <label className={styles.toggleRow}><input type="checkbox" checked={settings.quietHoursEnabled} onChange={(event) => setSettings({ ...settings, quietHoursEnabled: event.target.checked })} /><span><strong>Quiet hours</strong><small>Prevent automated customer texts overnight.</small></span></label>
      </article>
      <article className={styles.panel}><div className={styles.formGrid}><div className={styles.field}><label>Quiet hours begin</label><input type="time" value={settings.quietHoursStart} onChange={(event) => setSettings({ ...settings, quietHoursStart: event.target.value })} /></div><div className={styles.field}><label>Quiet hours end</label><input type="time" value={settings.quietHoursEnd} onChange={(event) => setSettings({ ...settings, quietHoursEnd: event.target.value })} /></div><div className={styles.field}><label>Maximum follow-up touches</label><input type="number" min="0" max="6" value={settings.maxFollowUpTouches} onChange={(event) => setSettings({ ...settings, maxFollowUpTouches: Number(event.target.value) })} /></div></div><div className={styles.formActions}><button className={styles.button} disabled={saving} type="button" onClick={saveSettings}>Save controls</button></div><p className={styles.safetyNote}>YardOps stops queued follow-ups when a lead is deleted, converted, opts out, or automation is paused. Meta lead forms connect directly to OPWP YardOps.</p></article>
    </section> : null}

    {tab === "playbook" ? <section className={styles.playbookWorkspace}>
      <div className={styles.playbookEvidence}><span className={styles.kicker}>Observed customer patterns</span><h2>OPWP answer intelligence</h2><p>The expanded library covers the questions repeated across Quo and Meta: exact price, weekly versus biweekly, one-time cleanups, route day, arrival window, whether the customer must be home, gate access, starting service, billing, and payment arrangements.</p><div><span>Dynamic prices use the saved quote</span><span>Route answers use current service rules</span><span>Exceptions stay human-reviewed</span></div></div>
      <section className={styles.playbookGrid}><div className={styles.answerList}>{answers.map((answer) => <button type="button" key={answer.answer_key} onClick={() => setAnswerDraft({ answerKey: answer.answer_key, category: answer.category, question: answer.question, answer: answer.answer_template, keywords: JSON.parse(answer.keywords || "[]").join(", "), responseMode: answer.response_mode, autoSendAllowed: Boolean(answer.auto_send_allowed) })}><span>{answer.category}</span><strong>{answer.question}</strong><small>{answer.auto_send_allowed ? "Exact automatic reply allowed" : "Suggestion / human review"} · v{answer.version}</small></button>)}</div>
        <article className={styles.panel}><div className={styles.sectionHead}><h2>{answerDraft.answerKey ? "Edit approved answer" : "Add an OPWP answer"}</h2><span>Versioned</span></div><div className={styles.formGrid}><div className={styles.field}><label>Stable key</label><input maxLength={60} value={answerDraft.answerKey} onChange={(event) => setAnswerDraft({ ...answerDraft, answerKey: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") })} placeholder="spring_cleanup" /></div><div className={styles.field}><label>Category</label><input maxLength={60} value={answerDraft.category} onChange={(event) => setAnswerDraft({ ...answerDraft, category: event.target.value })} /></div><div className={`${styles.field} ${styles.fieldWide}`}><label>Customer question</label><input maxLength={240} value={answerDraft.question} onChange={(event) => setAnswerDraft({ ...answerDraft, question: event.target.value })} /></div><div className={`${styles.field} ${styles.fieldWide}`}><label>Approved OPWP response</label><textarea maxLength={2000} value={answerDraft.answer} onChange={(event) => setAnswerDraft({ ...answerDraft, answer: event.target.value })} /></div><div className={`${styles.field} ${styles.fieldWide}`}><label>Match phrases, separated by commas</label><input value={answerDraft.keywords} onChange={(event) => setAnswerDraft({ ...answerDraft, keywords: event.target.value })} /></div><div className={styles.field}><label>Response source</label><select value={answerDraft.responseMode} onChange={(event) => setAnswerDraft({ ...answerDraft, responseMode: event.target.value })}><option value="static">Approved text</option><option value="pricing">Saved quote price</option><option value="service_day">Route-day policy</option><option value="handoff">Human handoff</option></select></div><label className={styles.toggleRow}><input type="checkbox" checked={answerDraft.autoSendAllowed} onChange={(event) => setAnswerDraft({ ...answerDraft, autoSendAllowed: event.target.checked })} /><span><strong>Exact auto-reply allowed</strong><small>Dynamic pricing and handoffs should stay reviewed.</small></span></label></div><div className={styles.formActions}><button type="button" className={styles.buttonSecondary} onClick={() => setAnswerDraft(emptyAnswer)}>Clear</button><button type="button" className={styles.button} disabled={saving} onClick={saveAnswer}>Save answer</button></div></article>
      </section>
    </section> : null}

    {tab === "pipeline" ? <>
      <div className={styles.sourceNav} role="tablist" aria-label="Lead sources">{SOURCE_TABS.map(([value, name]) => {
        const count = value === "all" ? leads.length : leads.filter((lead) => leadSourceBucket(lead) === value).length;
        return <button key={value} type="button" role="tab" aria-selected={sourceTab === value} className={sourceTab === value ? styles.sourceNavActive : ""} onClick={() => {
          const nextLead = value === "all" ? leads[0] : leads.find((lead) => leadSourceBucket(lead) === value);
          setSourceTab(value); setStageFilter(value === "all" ? "open" : "all"); setQuickFilter("all"); setOutcomeFilter(""); setQuery(""); setSelectedId(nextLead?.id || ""); setMessage(nextLead ? suggestedReply(nextLead, answers) : "");
        }}>{name}<span>{count}</span></button>;
      })}</div>
      <section className={styles.metrics}>{metricItems.map(([name, value, stage, quick, hint]) => <button type="button" className={`${styles.metric} ${stageFilter === stage && quickFilter === quick ? styles.metricActive : ""}`} key={name} onClick={() => openPipeline(stage, quick)}><span>{name}</span><strong>{value}</strong><small>{hint}</small><i>View records →</i></button>)}</section>
      <section className={styles.workQueue} aria-label="Action queues"><div><span>Work queue</span><strong>Focus on what needs attention now</strong></div><button type="button" className={quickFilter === "overdue" ? styles.queueActive : ""} onClick={() => openPipeline("all", "overdue", "", "", sourceTab)}><b>{counts.overdue}</b><span>Overdue</span></button><button type="button" className={quickFilter === "untouched" ? styles.queueActive : ""} onClick={() => openPipeline("all", "untouched", "", "", sourceTab)}><b>{counts.untouched}</b><span>Untouched</span></button><button type="button" className={quickFilter === "unassigned" ? styles.queueActive : ""} onClick={() => openPipeline("all", "unassigned", "", "", sourceTab)}><b>{counts.unassigned}</b><span>Unassigned</span></button></section>
      <div className={styles.toolbar}><input aria-label="Search leads" placeholder="Search name, email, phone, ZIP, outcome, or next action" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filter by stage" value={stageFilter} onChange={(event) => { setStageFilter(event.target.value); setQuickFilter("all"); setOutcomeFilter(""); }}><option value="open">Open stages</option><option value="all">All stages</option>{STAGES.map((stage) => <option value={stage} key={stage}>{label(stage)}</option>)}</select>{quickFilter !== "all" ? <button type="button" className={styles.clearFilter} onClick={() => setQuickFilter("all")}>Clear {label(quickFilter)}</button> : null}{outcomeFilter ? <button type="button" className={styles.clearFilter} onClick={() => setOutcomeFilter("")}>Clear {label(outcomeFilter)}</button> : null}<span className={styles.resultCount}>{filtered.length} of {sourceLeads.length} leads</span></div>
      <section className={styles.desk}>
        <div className={styles.leadList} aria-label="YardOps lead list">{filtered.length ? filtered.map((lead) => <button type="button" className={`${styles.leadButton} ${lead.id === selected?.id ? styles.leadActive : ""}`} onClick={() => { setSelectedId(lead.id); setMessage(suggestedReply(lead, answers)); setStatus({ message: "", error: false }); }} key={lead.id}><div className={styles.leadTop}><strong>{lead.name}</strong><span className={priorityClass(lead.priority)}>{label(lead.stage)}</span></div><div className={styles.leadMeta}><span>{SOURCE_NAMES[leadSourceBucket(lead)]}</span><span>{dateTime(lead.activityAt)}</span></div><div className={styles.leadAction}>{["lost", "not_qualified"].includes(lead.stage) ? `${label(lead.stage)} · ${label(lead.outcomeReason) || "Reason needed"}` : lead.nextAction ? `${dateTime(lead.nextActionAt)} · ${lead.nextAction}` : "No office next action scheduled"}</div></button>) : <div className={styles.empty}>No leads match these filters.</div>}</div>
        {selected ? <article className={styles.panel}>
          <header className={styles.detailHead}><div><div className={styles.detailLabel}>{selected.origin?.name || "OPWP lead record"}</div><h2>{selected.name}</h2><p>{label(selected.kind)} · {selected.zip || "ZIP pending"} · captured {dateTime(selected.createdAt)}</p></div><div className={styles.contactActions}><a href="#lead-origin">Source details</a>{leadSourceBucket(selected) === "meta" ? <a href="https://business.facebook.com/latest/leads_center" target="_blank" rel="noreferrer">Open Meta</a> : null}{selected.phone ? <a href={`tel:${selected.phone}`}>Call</a> : null}{selected.phone ? <a href="https://my.quo.com/" target="_blank" rel="noreferrer" onClick={(event) => openQuoText(event, selected.phone)}>Open Quo</a> : null}{selected.email ? <a href={`mailto:${selected.email}`}>Email</a> : null}</div></header>
          <section className={styles.originCard} id="lead-origin"><div className={styles.originTitle}><span>Source provenance</span><strong>Where this record came from</strong></div><div><span>Channel</span><strong>{selected.origin?.name || label(selected.source)}</strong></div><div><span>YardOps ID</span><strong title={selected.id}>{selected.id.slice(0, 8)}…</strong></div><div><span>External source ID</span><strong title={selected.origin?.externalId || ""}>{selected.origin?.externalId || "Not supplied"}</strong></div><div><span>Airtable sync</span><strong>{label(selected.airtable?.status || "not queued")}</strong></div>{selected.origin?.formId ? <div><span>Meta form ID</span><strong>{selected.origin.formId}</strong></div> : null}</section>
          <MetaLeadPanel key={selected.id} lead={selected} mutate={mutate} onGuidance={(guidance, audited) => setLeads((current) => current.map((lead) => lead.id === selected.id ? { ...lead, meta: { ...lead.meta, routeGuidance: guidance, routeAuditedAt: audited ? new Date().toISOString() : lead.meta.routeAuditedAt } } : lead))} />
          <section className={styles.section}><div className={styles.sectionHead}><h3>Lead and quote context</h3><span>Read-only source data</span></div><div className={styles.facts}><Fact name="Monthly quote" value={money(selected.quote.monthly)} /><Fact name="Frequency" value={label(selected.quote.frequency)} /><Fact name="Dogs" value={selected.quote.dogs} /><Fact name="Yard" value={label(selected.quote.yard)} /><Fact name="Phone" value={selected.phone} /><Fact name="Email" value={selected.email} /><Fact name="SMS consent" value={selected.quote.consent ? `Recorded ${dateTime(selected.quote.consentAt)}` : "Not recorded"} /><Fact name="Sweep & Go" value={`${label(selected.sng.state)}${selected.sng.id ? ` · ${selected.sng.id}` : ""}`} /></div>{selected.quote.question ? <div className={styles.question}><strong>Customer question:</strong> {selected.quote.question}</div> : null}</section>
          <section className={styles.section}><div className={styles.sectionHead}><h3>Conversation and next reply</h3><span>{label(selected.conversation?.automationMode || "suggest")} mode</span></div><div className={styles.modeButtons}>{[["paused", "Manual"], ["suggest", "Suggest"], ["approved", "Approved auto"]].map(([value, name]) => <button type="button" className={selected.conversation?.automationMode === value ? styles.modeActive : ""} onClick={() => setAutomation(value)} key={value}>{name}</button>)}{selected.source !== "facebook" ? <button type="button" onClick={startNurture}>Prepare 7-day sequence</button> : null}</div><div className={styles.messages}>{selected.conversation?.messages?.length ? selected.conversation.messages.map((item) => <div className={`${styles.message} ${item.direction === "outbound" ? styles.messageOutbound : ""}`} key={item.id}><span>{item.direction === "outbound" ? "OPWP" : selected.name}</span><p>{item.body}</p><small>{dateTime(item.created_at)} · {label(item.delivery_status)}</small></div>) : <div className={styles.empty}>No conversation messages recorded yet. Use a suggested response or write your own.</div>}</div><div className={styles.composer}><textarea maxLength={1000} placeholder="Write an OPWP reply..." value={message} onChange={(event) => setMessage(event.target.value)} /><div className={styles.composerFooter}><input type="datetime-local" aria-label="Follow-up time" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} /><button className={styles.buttonSecondary} type="button" disabled={saving || !message.trim()} onClick={scheduleFollowUp}>Schedule</button><button className={styles.button} type="button" disabled={saving || !message.trim()} onClick={sendMessage}>Send text</button></div></div>{(selected.followUps || []).length ? <div className={styles.deliveryList}>{selected.followUps.map((job) => <div className={styles.deliveryRow} key={job.id}><strong>Touch {job.sequence_step}: {label(job.status)}</strong><span>{dateTime(job.due_at)}</span></div>)}<div className={styles.formActions}><button className={styles.textButton} type="button" onClick={cancelFollowUps}>Cancel pending follow-ups</button></div></div> : null}</section>
          <section className={styles.section}>
            <div className={styles.sectionHead}><h3>Office workflow and outcome</h3><span>Separate from public quote state</span></div>
            <div className={styles.formGrid}>
              <div className={styles.field}><label htmlFor="growth-stage">Stage</label><select id="growth-stage" value={draft.stage} disabled={selected.stageLocked} onChange={(event) => updateStage(event.target.value)}>{STAGES.map((stage) => <option value={stage} key={stage}>{label(stage)}</option>)}</select></div>
              <div className={styles.field}><label htmlFor="growth-priority">Priority</label><select id="growth-priority" value={draft.priority} onChange={(event) => updateDraft("priority", event.target.value)}>{PRIORITIES.map((priority) => <option value={priority} key={priority}>{label(priority)}</option>)}</select></div>
              <div className={styles.field}><label htmlFor="growth-owner">Owner</label><select id="growth-owner" value={draft.owner} onChange={(event) => updateDraft("owner", event.target.value)}><option value="me">Me · {currentAdmin}</option><option value="unassigned">Unassigned</option></select></div>
              <div className={styles.field}><label htmlFor="growth-due">Next action due</label><input id="growth-due" type="datetime-local" value={draft.nextActionAt} onChange={(event) => updateDraft("nextActionAt", event.target.value)} /></div>
              <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="growth-action">Next action</label><input id="growth-action" maxLength={240} placeholder="Call about weekly service and answer the gate question" value={draft.nextAction} onChange={(event) => updateDraft("nextAction", event.target.value)} /></div>
              {["lost", "not_qualified"].includes(draft.stage) ? <>
                <div className={styles.field}><label htmlFor="outcome-reason">{draft.stage === "not_qualified" ? "Why is this lead not qualified? *" : "Why was this lead lost? *"}</label><select id="outcome-reason" value={draft.outcomeReason} onChange={(event) => updateDraft("outcomeReason", event.target.value)}><option value="">Choose a reason</option>{(draft.stage === "not_qualified" ? GROWTH_NOT_QUALIFIED_REASONS : GROWTH_LOSS_REASONS).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></div>
                <div className={styles.field}><label htmlFor="outcome-note">Outcome context</label><input id="outcome-note" maxLength={500} placeholder="What should OPWP learn from this?" value={draft.outcomeNote} onChange={(event) => updateDraft("outcomeNote", event.target.value)} /></div>
              </> : <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="outcome-note">Outcome context (optional)</label><input id="outcome-note" maxLength={500} placeholder="Conversion details or useful context" value={draft.outcomeNote} onChange={(event) => updateDraft("outcomeNote", event.target.value)} /></div>}
            </div>
            <div className={styles.formActions}><button className={styles.button} type="button" disabled={saving || (["lost", "not_qualified"].includes(draft.stage) && !draft.outcomeReason)} onClick={saveState}>Save workflow</button></div>
          </section>
          <section className={styles.section}><div className={styles.sectionHead}><h3>Recovery delivery</h3><span>Existing quote workflow</span></div><div className={styles.deliveryList}>{selected.deliveries.length ? selected.deliveries.map((delivery) => <div className={styles.deliveryRow} key={delivery.channel}><strong>{deliveryLabel(delivery.channel)}</strong><span>{label(delivery.status)}{delivery.sent_at ? ` · ${dateTime(delivery.sent_at)}` : ""}</span></div>) : <div className={styles.empty}>No customer recovery was queued for this record.</div>}{selected.notifications.map((item) => <div className={styles.deliveryRow} key={`${item.notification_type}-${item.channel}`}><strong>Owner {label(item.notification_type)}</strong><span>{label(item.status)}</span></div>)}</div></section>
          <section className={styles.section}><div className={styles.sectionHead}><h3>Notes and audit timeline</h3><span>Signed-in admin</span></div><div className={styles.noteBox}><textarea maxLength={2000} placeholder="Record the call outcome, objection, requested timing, or handoff context." value={note} onChange={(event) => setNote(event.target.value)} /><div className={styles.formActions}><button className={styles.button} type="button" disabled={saving || !note.trim()} onClick={addNote}>Add note</button></div></div><div className={styles.timeline}>{selected.events.map((event) => <div className={styles.timelineItem} key={event.id}><div><strong>{event.summary}</strong><small>{label(event.event_type)} · {event.actor_email}</small></div><small>{dateTime(event.created_at)}</small></div>)}<div className={styles.timelineItem}><div><strong>{selected.stageLocked ? "Customer conversion recorded" : "Lead captured"}</strong><small>{selected.origin?.name || "System source event"}</small></div><small>{dateTime(selected.activityAt)}</small></div></div><div className={styles.dangerZone}><div><strong>Not a real lead?</strong><span>Removes contact details, messages, and queued follow-ups while preserving a redacted audit marker.</span></div><button type="button" disabled={saving} onClick={deleteSelectedLead}>Delete lead</button></div></section>
        </article> : <div className={`${styles.panel} ${styles.emptyState}`}><span className={styles.kicker}>{sourceLeads.length ? "Filtered view" : "Inbox clear"}</span><h2>{sourceLeads.length ? "No leads match this view" : "YardOps is ready for the next lead"}</h2><p>{sourceLeads.length ? "Clear a filter or choose another source to return to the active pipeline." : "New website partial quotes, Meta lead forms, and qualified Quo prospect texts will arrive here automatically. Deleted and irrelevant records stay out of active reporting."}</p><div className={styles.emptyActions}>{sourceLeads.length ? <button type="button" className={styles.button} onClick={() => openPipeline("all", "all", "", "", sourceTab)}>Clear filters</button> : <><button type="button" className={styles.button} onClick={() => setTab("analytics")}>Open analytics</button><button type="button" className={styles.buttonSecondary} onClick={() => setTab("playbook")}>Review answer playbook</button></>}</div><div className={styles.emptyChecklist}>{healthItems.map((item) => <div key={item.key}><span>{item.name}</span><strong>{item.state}</strong></div>)}</div></div>}
      </section>
    </> : null}
  </>;
}
