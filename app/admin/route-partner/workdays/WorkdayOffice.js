"use client";
import { useEffect, useState } from "react";
import { operatingDate } from "@/lib/field-policy.mjs";
import { workdaySummary } from "@/lib/field-workday-model.mjs";
import s from "./office.module.css";

async function request(url, options = {}) {
  const r = await fetch(url, { ...options, cache: "no-store" }),
    data = await r.json();
  if (!r.ok || !data.ok)
    throw new Error(data.error || "Office request failed.");
  return data;
}
export default function WorkdayOffice({ sandbox = false }) {
  const API = sandbox ? "/api/field-sandbox/office/" : "/api/admin/field-workdays/";
  const proofBase = sandbox ? "/api/field-sandbox/workday/photo/" : "/api/field/workday/photo/";
  const [date, setDate] = useState(operatingDate()),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("days");
  async function load() {
    try {
      setData(await request(`${API}?date=${date}`));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [date]);
  async function action(body) {
    setBusy(true);
    setNotice("");
    try {
      const result = await request(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setNotice(result.message);
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={s.main}>
      <div className={s.title}>
        <div>
          <span>ROUTE PARTNER · OFFICE</span>
          <h1>Field operations & services</h1>
          <p>Coordinate technicians, add-on work and exceptions.</p>
        </div>
        <a href={sandbox ? "/field-sandbox/" : "/admin/route-partner/"}>Daily dispatch</a>
      </div>
      <div className={s.toolbar}>
        <label>
          Service date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button onClick={() => void load()}>Refresh</button>
        <button onClick={() => setTab("days")}>Workdays</button>
        <button onClick={() => setTab("services")}>Service catalog</button>
        <a href={sandbox ? "/api/field-sandbox/record/" : "/admin/route-partner/sync/"}>{sandbox ? "Test day JSON / closeout" : "SNG closeouts"}</a>
        <a href={sandbox ? "/field-sandbox/" : "/field/app/"} target="_blank" rel="noreferrer">
          Technician app
        </a>
      </div>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={s.notice} role="status">
          {notice}
        </p>
      ) : null}
      <p className={s.banner}>
        {sandbox ? "TRAINING ONLY. Fictional workdays, catalog and office changes share this browser session. No customer messages, provider writes, payroll or billing. Refresh shows saved progress; it does not create a new route." : <>SNG dispatch import and completion verification use the existing
        integration. Automatic SNG service/payroll writes are unavailable.
        Office changes require technician acceptance. Quo sending remains off
        until its field transport and current recipient preferences are
        verified.</>}
      </p>
      {!data ? (
        <p>Loading office view...</p>
      ) : tab === "services" ? (
        <>
          <section className={s.card}>
            <h2>Configurable services</h2>
            <p>
              Timing defaults are editable operational allowances, not verified
              historical estimates or customer prices. Saved changes apply to
              newly assigned work; existing tasks retain their reviewed rules.
            </p>
          </section>
          {data.catalog.map((service) => (
            <ServiceEditor
              key={service.id}
              service={service}
              busy={busy}
              onSave={(service) => action({ action: "save_service", service })}
            />
          ))}
          <ServiceEditor
            key="new"
            service={{
              id: "",
              name: "",
              unitLabel: "unit",
              minutesPerUnit: 0,
              timed: true,
              entryRequired: true,
              proofKind: "service",
              active: true,
              instructions: "",
            }}
            busy={busy}
            onSave={(service) => action({ action: "save_service", service })}
          />
        </>
      ) : (
        <>
          <section className={s.card}>
            <h2>Service timing evidence · past 30 days</h2>
            <p>
              {data.insights.workdays} workdays · {data.insights.completed}{" "}
              completed services · {data.insights.skipped} exceptions ·{" "}
              {data.insights.timingCoverage}% timing coverage
            </p>
            {data.insights.services.map((row) => (
              <p key={row.id}>
                <b>{row.name}</b>: median {row.medianMinutesPerUnit} min/
                {row.unitLabel}, {row.samples} observations · average allowance{" "}
                {row.meanAllowanceMinutes} min.
                {row.suggestedMinutesPerUnit !== null
                  ? ` Review allowance of ${row.suggestedMinutesPerUnit} min/unit in the catalog.`
                  : " More observations needed before suggesting a change."}
              </p>
            ))}
            <small>
              Observed completion times inform office review. Allowances and
              customer schedules never change automatically.
            </small>
          </section>
          {data.released.map((shift) => (
            <section className={s.card} key={shift.id}>
              <h2>{shift.display_name} · released route</h2>
              <button
                disabled={busy}
                onClick={() =>
                  action({ action: "open_workday", shiftId: shift.id })
                }
              >
                Prepare workday for service review
              </button>
            </section>
          ))}
          {data.days.length === 0 ? (
            <section className={s.card}>
              <h2>No unified workdays opened yet</h2>
              <p>
                Release a real route in Daily dispatch. Its assigned technician
                opens the new app online to initialize the workday. An
                already-started pilot shift must finish in the pilot.
              </p>
            </section>
          ) : null}
          {data.days.map((day) => (
            <OfficeDay
              key={day.id}
              day={day}
              proofBase={proofBase}
              catalog={data.catalog}
              recurring={data.recurring}
              changes={data.changes.filter((c) => c.shift_id === day.id)}
              messages={data.messages.filter((m) => m.shift_id === day.id)}
              busy={busy}
              onAction={action}
            />
          ))}
        </>
      )}
    </main>
  );
}
function ServiceEditor({ service, busy, onSave }) {
  const [value, setValue] = useState(service);
  return (
    <form
      className={s.card}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(value);
      }}
    >
      <h2>{service.id ? service.name : "Add another service"}</h2>
      <div className={s.grid}>
        <label>
          Stable service ID
          <input
            value={value.id}
            readOnly={!!service.id}
            required
            pattern="[a-z][a-z0-9_-]{1,39}"
            onChange={(e) => setValue({ ...value, id: e.target.value })}
          />
        </label>
        <label>
          Display name
          <input
            value={value.name}
            required
            maxLength={100}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          Quantity unit
          <input
            value={value.unitLabel}
            required
            maxLength={30}
            onChange={(e) => setValue({ ...value, unitLabel: e.target.value })}
          />
        </label>
        <label>
          Minutes per unit
          <input
            type="number"
            min="0"
            max="240"
            step=".5"
            required
            value={value.minutesPerUnit}
            onChange={(e) =>
              setValue({ ...value, minutesPerUnit: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Required proof
          <select
            value={value.proofKind}
            onChange={(e) => setValue({ ...value, proofKind: e.target.value })}
          >
            <option value="none">No required photo</option>
            <option value="gate">Latched gate, where present</option>
            <option value="service">Service proof</option>
            <option value="delivery" disabled={value.id !== "food"}>
              Food delivery proof
            </option>
          </select>
        </label>
      </div>
      <div className={s.toolbar}>
        {[
          ["timed", "Record service time"],
          ["entryRequired", "Safe entry required"],
          ["active", "Available for assignment"],
        ].map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={value[key]}
              onChange={(e) => setValue({ ...value, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <label>
        Service instructions
        <textarea
          maxLength={2000}
          value={value.instructions}
          onChange={(e) => setValue({ ...value, instructions: e.target.value })}
        />
      </label>
      <button disabled={busy}>Save service</button>
    </form>
  );
}
function OfficeDay({
  day,
  proofBase,
  catalog,
  recurring,
  changes,
  messages,
  busy,
  onAction,
}) {
  const summary = workdaySummary(day),
    [stopId, setStopId] = useState(day.stops[0]?.id || ""),
    [serviceId, setServiceId] = useState("litter"),
    [quantity, setQuantity] = useState(1),
    [notes, setNotes] = useState(""),
    [kind, setKind] = useState("add_service"),
    [everyWeeks, setEveryWeeks] = useState(1),
    [startDate, setStartDate] = useState(day.date),
    [weekdays, setWeekdays] = useState([
      new Date(`${day.date}T12:00:00Z`).getUTCDay(),
    ]),
    [recurringActive, setRecurringActive] = useState(true),
    [billingReviewed, setBillingReviewed] = useState(false),
    [gatePresent, setGatePresent] = useState(true),
    [replies, setReplies] = useState({}),
    [order, setOrder] = useState(day.stops.map((s) => s.id));
  useEffect(() => setOrder(day.stops.map((s) => s.id)), [day.revision]);
  const submit = (action, extra = {}) =>
    onAction({ action, shiftId: day.id, stopId, notes, ...extra });
  return (
    <section className={s.card}>
      <h2>
        {day.memberName} · {day.shift.status.replaceAll("_", " ")}
      </h2>
      <div className={s.metrics}>
        <b>
          {summary.completed}/{summary.services} completed
        </b>
        <b>{summary.skipped} skipped</b>
        <b>{summary.unresolvedIssues} open issues</b>
        <b>{Math.round(summary.paidSeconds / 60)} paid minutes</b>
      </div>
      <div className={s.grid}>
        <div>
          <h3>Property and service status</h3>
          {order.map((id, index) => {
            const stop = day.stops.find((s) => s.id === id),
              locked =
                !!stop.arrivedAt ||
                stop.tasks.some((t) =>
                  ["completed", "skipped"].includes(t.status),
                );
            return (
              <div className={s.stop} key={id}>
                <b>
                  {index + 1}. {stop.name}
                  {locked ? " · locked" : ""}
                </b>
                <p>
                  {stop.address} · {stop.safety}
                </p>
                {stop.tasks.map((t) => (
                  <p key={t.id}>
                    {t.title} · {t.quantity} {t.unitLabel} · {t.status}
                    {t.photos.map((photo) => (
                      <a
                        key={photo.id}
                        href={`${proofBase}?id=${photo.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {" "}
                        {photo.purpose} proof{" "}
                      </a>
                    ))}
                  </p>
                ))}
                <button
                  disabled={
                    busy ||
                    locked ||
                    index === 0 ||
                    !!day.stops.find((s) => s.id === order[index - 1])
                      ?.arrivedAt
                  }
                  onClick={() => {
                    const next = [...order];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    setOrder(next);
                  }}
                >
                  Move up
                </button>
              </div>
            );
          })}
          <button
            disabled={busy || day.shift.clockOut}
            onClick={() => submit("reorder", { stopIds: order })}
          >
            Propose reviewed stop order
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(kind, {
              serviceId,
              quantity,
              ...(kind === "save_recurring"
                ? {
                    everyWeeks,
                    startDate,
                    weekdays,
                    active: recurringActive,
                    billingReviewed,
                  }
                : {}),
            });
          }}
        >
          <h3>Add services / return visit</h3>
          <label>
            Property
            <select value={stopId} onChange={(e) => setStopId(e.target.value)}>
              {day.stops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Visit type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="add_service">Add to unfinished property</option>
              <option value="reclean">Separate return visit / reclean</option>
              <option value="save_recurring">
                Recurring on future imported visits
              </option>
            </select>
          </label>
          <label>
            Service
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              {catalog
                .filter((s) => s.active && s.id !== "food")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.unitLabel})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="1"
              max="50"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label>
            Office instructions / reason
            <textarea
              required
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {kind === "save_recurring" ? (
            <>
              <label>
                First eligible date
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
              <label>
                Repeat interval
                <select
                  value={everyWeeks}
                  onChange={(e) => setEveryWeeks(Number(e.target.value))}
                >
                  <option value={1}>Every week</option>
                  <option value={2}>Every two weeks</option>
                  <option value={4}>Every four weeks</option>
                </select>
              </label>
              <div className={s.toolbar}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (label, i) => (
                    <label key={label}>
                      <input
                        type="checkbox"
                        checked={weekdays.includes(i)}
                        onChange={(e) =>
                          setWeekdays(
                            e.target.checked
                              ? [...weekdays, i]
                              : weekdays.filter((d) => d !== i),
                          )
                        }
                      />
                      {label}
                    </label>
                  ),
                )}
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={recurringActive}
                  onChange={(e) => setRecurringActive(e.target.checked)}
                />
                Recurring service active (uncheck to disable this
                property/service)
              </label>
              <label>
                <input
                  type="checkbox"
                  required
                  checked={billingReviewed}
                  onChange={(e) => setBillingReviewed(e.target.checked)}
                />
                Customer authorization and billing arrangement reviewed
              </label>
              <small>
                Applies when a newly opened workday already contains this source
                property. This does not create standalone visits, charge
                customers or alter an open workday.
              </small>
            </>
          ) : null}
          <button
            disabled={
              busy || (!!day.shift.clockOut && kind !== "save_recurring")
            }
          >
            {kind === "save_recurring"
              ? "Save recurring service"
              : "Propose service change"}
          </button>
          <div className={s.toolbar}>
            <button
              type="button"
              disabled={busy || day.shift.clockOut}
              onClick={() => submit("safety", { safe: false })}
            >
              Report unsafe access
            </button>
            <button
              type="button"
              disabled={busy || day.shift.clockOut}
              onClick={() =>
                submit("safety", { safe: true, hasGate: gatePresent })
              }
            >
              Record verified safe clearance
            </button>
          </div>
          <label>
            <input
              type="checkbox"
              checked={gatePresent}
              onChange={(e) => setGatePresent(e.target.checked)}
            />
            Verified property has a gate (saved with safe clearance)
          </label>
          <small>
            Clearance expires after 30 minutes. Explain the verification in the
            office note. No customer billing is inferred from an add-on or
            reclean.
          </small>
        </form>
      </div>
      <details>
        <summary>Recurring service assignments for these properties</summary>
        {recurring
          .filter((r) =>
            day.stops.some((stop) => stop.propertyKey === r.property_key),
          )
          .map((r) => (
            <p key={r.id}>
              {r.property_name} · {r.service_id} · {r.quantity} units · every{" "}
              {r.every_weeks} week(s), weekdays{" "}
              {JSON.parse(r.weekdays)
                .map(
                  (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d],
                )
                .join(", ")}{" "}
              · {r.active ? "active" : "disabled"} · {r.instructions}
            </p>
          ))}
      </details>
      <h3>Exceptions and responses</h3>
      {day.issues.length === 0 ? (
        <p>No recorded issues.</p>
      ) : (
        day.issues.map((issue) => (
          <div className={s.stop} key={issue.id}>
            <b>{issue.reason}</b>
            <p>{issue.notes}</p>
            <p>
              {issue.response || "No office response"}
              {issue.acknowledgedAt ? " · acknowledged by technician" : ""}
            </p>
            <label>
              Office response
              <textarea
                value={replies[issue.id] || ""}
                maxLength={2000}
                onChange={(e) =>
                  setReplies({ ...replies, [issue.id]: e.target.value })
                }
              />
            </label>
            <button
              disabled={busy || !replies[issue.id]?.trim()}
              onClick={() =>
                onAction({
                  action: "response",
                  shiftId: day.id,
                  issueId: issue.id,
                  notes: replies[issue.id],
                })
              }
            >
              Send internal response for acknowledgment
            </button>
          </div>
        ))
      )}
      <details>
        <summary>Dispatch changes ({changes.length})</summary>
        {changes.map((c) => (
          <p key={c.id}>
            {c.kind} · {c.status} · {c.payload.reason || c.payload.text}
          </p>
        ))}
      </details>
      <details>
        <summary>Customer message receipts ({messages.length})</summary>
        {messages.map((m) => (
          <p key={m.id}>
            {m.kind} · {m.status} · {m.detail}
          </p>
        ))}
      </details>
    </section>
  );
}
