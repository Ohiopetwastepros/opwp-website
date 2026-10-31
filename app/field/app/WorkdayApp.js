"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  activeService,
  applyWorkdayEvent,
  BREAK_TYPES,
  ETA_OPTIONS,
  PRECHECKS,
  WRAPCHECKS,
  taskDone,
  workdaySummary,
} from "@/lib/field-workday-model.mjs";
import {
  adoptServerWorkday,
  assertDeviceSession,
  commitDeviceEvent,
  deviceAccount,
  readWorkdayDevice,
  syncDeviceWorkday,
  updateWorkdayDevice,
} from "@/lib/field-workday-device.mjs";
import { jobTimer, clockText } from "@/lib/field-timer.mjs";
import { operatingDate } from "@/lib/field-policy.mjs";
import PacingView from "../../field-demo/PacingView";
import s from "./workday.module.css";
const liveEnvironment = { API: "/api/field/workday/", sessionAPI: "/api/field/session/", workerUrl: "/field/sw.js", workerScope: "/field/", testMode: false };
const sandboxEnvironment = { API: "/api/field-sandbox/workday/", sessionAPI: "/api/field-sandbox/session/", workerUrl: "/field-sandbox/sw.js", workerScope: "/field-sandbox/", testMode: true };
const Environment = createContext(liveEnvironment);
async function request(url, options = {}) {
  const r = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    }),
    data = await r.json();
  if (!r.ok || !data.ok) {
    const e = new Error(data.error || "Connection unavailable.");
    e.status = r.status;
    throw e;
  }
  return data;
}
async function photoBlob(file) {
  if (!file || !file.type.startsWith("image/"))
    throw new Error("Choose a camera image.");
  const bitmap = await createImageBitmap(file),
    scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= 400 * 1024) return blob;
  }
  throw new Error(
    "This image is too detailed. Take a closer photo or choose a smaller image.",
  );
}
const pretty = (value) => String(value || "").replaceAll("_", " ");
const time = (value) =>
  value
    ? new Date(value).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "--";
const hours = (seconds) =>
  `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
export default function WorkdayApp({ sandbox = false }) {
  return <Environment.Provider value={sandbox ? sandboxEnvironment : liveEnvironment}><WorkdayScreen /></Environment.Provider>;
}
function WorkdayScreen() {
  const { API, sessionAPI, workerUrl, workerScope, testMode } = useContext(Environment);
  const [record, setRecord] = useState(null),
    [key, setKey] = useState(""),
    [loading, setLoading] = useState(true),
    [locked, setLocked] = useState(false),
    [online, setOnline] = useState(true),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(false),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [tab, setTab] = useState("today"),
    [selected, setSelected] = useState(""),
    [selectedTask, setSelectedTask] = useState(""),
    [date, setDate] = useState(operatingDate()),
    [modal, setModal] = useState(null),
    [pacing, setPacing] = useState(false),
    [now, setNow] = useState(Date.now());
  const account = useRef(""),
    syncLock = useRef(false),
    mutationLock = useRef(false),
    recordRef = useRef(null),
    syncFn = useRef(null);
  function accept(value) {
    // A slow backup/draft response must not roll back a newer local action on screen.
    if (
      value?.day &&
      recordRef.current?.day?.id === value.day.id &&
      value.day.revision < recordRef.current.day.revision
    )
      return;
    recordRef.current = value;
    setRecord(value);
  }
  async function refresh(chosen = date) {
    const result = await request(`${API}?date=${chosen}`),
      nextKey = `${result.member.organizationId}:${result.member.id}`;
    const saved = await readWorkdayDevice(nextKey);
    const next = await updateWorkdayDevice(nextKey, (current) =>
      adoptServerWorkday(current, result),
    );
    account.current = nextKey;
    setKey(nextKey);
    accept(next);
    setLocked(false);
    return next;
  }
  async function synchronize() {
    if (syncLock.current || !account.current || !navigator.onLine) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      assertDeviceSession(
        account.current,
        await request(sessionAPI),
      );
      const saved = await syncDeviceWorkday(account.current, {
        event: (event) =>
          request(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
          }),
        upload: (event, blob) =>
          request(
            `${API}photo/?${new URLSearchParams({ id: event.body.photoId, shiftId: event.shiftId, taskId: event.body.taskId, purpose: event.body.purpose, capturedAt: event.recordedAt })}`,
            {
              method: "PUT",
              headers: { "Content-Type": "image/jpeg" },
              body: blob,
            },
          ),
      });
      if (saved) accept(saved);
      await refresh(saved?.day?.date || date);
      setSyncError("");
    } catch (e) {
      setSyncError(e.message);
      if ([401, 403].includes(e.status)) {
        setLocked(true);
        accept(null);
      }
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }
  syncFn.current = synchronize;
  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        await refresh();
      } catch (e) {
        if ([401, 403].includes(e.status)) {
          setLocked(true);
        } else {
          try {
            const active = await deviceAccount(),
              saved = active && (await readWorkdayDevice(active));
            if (saved && Date.parse(saved.offlineUntil) > Date.now()) {
              account.current = active;
              setKey(active);
              accept(saved);
              setDate(saved.day?.date || operatingDate());
              setSyncError(
                "Working from the device copy. Reconnect to back up.",
              );
            } else {
              setLocked(true);
              setError(e.message);
            }
          } catch (storage) {
            setError(storage.message);
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    void boot();
    const tick = setInterval(() => setNow(Date.now()), 1000),
      retry = setInterval(() => void syncFn.current?.(), 15000);
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void syncFn.current?.();
    };
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      clearInterval(tick);
      clearInterval(retry);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let alive = true;
    void navigator.serviceWorker
      .register(workerUrl, { scope: workerScope })
      .catch(async (error) => {
        const existing =
          await navigator.serviceWorker.getRegistration(workerScope);
        if (!existing?.active) throw error;
        return existing;
      })
      .then((registration) =>
        registration.active
          ? registration
          : Promise.race([
              navigator.serviceWorker.ready,
              new Promise((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        "Keep the app online until offline preparation finishes.",
                      ),
                    ),
                  25000,
                ),
              ),
            ]),
      )
      .then(
        (registration) =>
          new Promise((resolve, reject) => {
            const channel = new MessageChannel(),
              timeout = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Keep the app online until the offline download finishes.",
                    ),
                  ),
                25000,
              );
            channel.port1.onmessage = (e) => {
              clearTimeout(timeout);
              channel.port1.close();
              e.data?.ok || e.data?.cached
                ? resolve()
                : reject(new Error("Offline download failed."));
            };
            registration.active.postMessage({ type: "PREPARE_FIELD" }, [
              channel.port2,
            ]);
          }),
      )
      .then(() => {
        if (alive) setReady(true);
      })
      .catch((e) => {
        if (alive) setSyncError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function dispatch(type, body = {}, photo = null) {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      const changes =
        type === "accept_changes" ? recordRef.current.changes : [];
      if (
        type === "accept_changes" &&
        (!navigator.onLine || recordRef.current.pending.length)
      )
        throw new Error(
          "Back up pending work before accepting office changes.",
        );
      const next = await commitDeviceEvent(account.current, type, body, {
        photo,
        changes,
      });
      accept(next);
      void syncFn.current?.();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  async function addPhoto(task, file, purpose) {
    try {
      const blob = await photoBlob(file);
      await dispatch(
        "add_photo",
        { taskId: task.id, photoId: crypto.randomUUID(), purpose },
        blob,
      );
    } catch (e) {
      setError(e.message);
    }
  }
  async function draft(taskId, value) {
    try {
      accept(
        await updateWorkdayDevice(account.current, (saved) => ({
          ...saved,
          drafts: { ...saved.drafts, [taskId]: value },
        })),
      );
    } catch (e) {
      setError(e.message);
    }
  }
  async function exportDay() {
    try {
      const saved = await readWorkdayDevice(account.current),
        photos = {};
      for (const [id, blob] of Object.entries(saved.photos || {}))
        photos[id] = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify({
              ...saved,
              photos,
              exportedAt: new Date().toISOString(),
              private: true,
            }),
          ],
          { type: "application/json" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `opwp-workday-${saved.day?.date || "saved"}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    }
  }
  async function logout() {
    if (record?.pending.length) {
      setError(
        "Back up pending work before signing out. Export a private recovery copy if sync needs review.",
      );
      return;
    }
    try {
      await request(sessionAPI, { method: "DELETE" });
      await updateWorkdayDevice(account.current, () => null);
      accept(null);
      setLocked(true);
    } catch (e) {
      setError(e.message);
    }
  }
  const day = record?.day,
    summary = day ? workdaySummary(day, now) : null,
    active = day && activeService(day),
    activeStop = day?.stops.find((s) =>
      s.tasks.some((t) => t.id === active?.id),
    ),
    stop =
      day?.stops.find((s) => s.id === selected) ||
      activeStop ||
      day?.stops.find((s) => !s.tasks.every(taskDone)) ||
      day?.stops.at(-1),
    leaseExpired =
      record &&
      (!Number.isFinite(Date.parse(record.offlineUntil)) ||
        Date.parse(record.offlineUntil) <= now),
    pending = record?.pending.length || 0,
    disabled =
      busy ||
      leaseExpired ||
      locked ||
      record?.sourceChanged ||
      day?.date > operatingDate();
  return (
    <div className={`opwp-field-shell ${s.shell}`}>
      <header className={s.header}>
        <img src="/assets/opwp-logo.webp" alt="Ohio Pet Waste Pros" />
        <div>
          <b>OPWP FIELD</b>
          <span>One route. Every service.</span>
        </div>
        <button onClick={logout} disabled={!record || pending > 0}>
          Sign out
        </button>
      </header>
      <div
        className={`${s.connection} ${!online || syncError ? s.warning : ""}`}
        role="status"
      >
        <b>
          {!online
            ? "Offline - saved on this device"
            : syncing
              ? "Backing up"
              : syncError
                ? "Sync needs attention"
                : pending
                  ? `${pending} waiting to back up`
                  : "Server copy up to date"}
        </b>
        <span>{ready ? "Offline ready" : "Preparing offline shell"}</span>
      </div>
      <main className={s.main}>
        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}
        {syncError ? (
          <p className={s.tip}>
            {syncError}{" "}
            {record ? (
              <button onClick={() => void synchronize()}>Retry backup</button>
            ) : null}
          </p>
        ) : null}
        {loading ? (
          <div className={s.card}>Opening your assigned workday...</div>
        ) : locked ? (
          <Login
            onLogin={async () => {
              try {
                await refresh();
                void synchronize();
              } catch (e) {
                setError(e.message);
              }
            }}
          />
        ) : leaseExpired ? (
          <div className={s.card}>
            <h1>Sign in online again</h1>
            <p>
              The offline access window ended. Pending work stays on this
              device.
            </p>
            <button onClick={() => void synchronize()}>
              Verify session online
            </button>
            <button onClick={exportDay}>Export private recovery copy</button>
          </div>
        ) : !day ? (
          <div className={s.card}>
            <h1>No released route</h1>
            <p>
              The office must release an assigned route before work can start.
            </p>
            <label>
              Service date
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  void refresh(e.target.value).catch((e) =>
                    setError(e.message),
                  );
                }}
              />
            </label>
            <button
              onClick={() => void refresh().catch((e) => setError(e.message))}
            >
              Refresh
            </button>
            <a href="/field/pilot/">Finish an earlier pilot shift</a>
          </div>
        ) : (
          <>
            <div className={s.title}>
              <div>
                <span>
                  {day.memberName} · {day.date}
                </span>
                <h1>
                  {tab === "today"
                    ? "Today’s workday"
                    : tab === "route"
                      ? "Your route"
                      : tab === "activity"
                        ? "Day record"
                        : "Workday tools"}
                </h1>
              </div>
              <button
                disabled={
                  pending > 0 || (!!day.shift.clockIn && !day.shift.clockOut)
                }
                onClick={() => {
                  const next = new Date(`${operatingDate()}T12:00:00Z`);
                  if (day.date === operatingDate())
                    next.setUTCDate(next.getUTCDate() + 1);
                  const d = next.toISOString().slice(0, 10);
                  setDate(d);
                  void refresh(d).catch((e) => setError(e.message));
                }}
              >
                {day.date === operatingDate() ? "Tomorrow" : "Today"}
              </button>
            </div>
            <div className={s.stats}>
              <span>
                <b>
                  {summary.stopsFinished}/{summary.stops}
                </b>
                Properties
              </span>
              <span>
                <b>
                  {summary.accounted}/{summary.services}
                </b>
                Services accounted
              </span>
              <span>
                <b>{hours(summary.paidSeconds)}</b>Recorded paid time
              </span>
            </div>
            {record.sourceChanged ? (
              <section className={`${s.card} ${s.attention}`} role="alert">
                <h2>Dispatch source changed</h2>
                <p>
                  Contact the office before continuing. Saved work is retained
                  for reconciliation.
                </p>
                <button onClick={exportDay}>
                  Export private recovery copy
                </button>
              </section>
            ) : null}
            {record.changes?.length ? (
              <section className={`${s.card} ${s.attention}`}>
                <h2>Office changes to review</h2>
                {record.changes.map((c) => (
                  <p key={c.id}>
                    <b>{pretty(c.kind)}</b>:{" "}
                    {c.payload.reason || c.payload.text}
                  </p>
                ))}
                <button
                  disabled={disabled || !!active || pending > 0 || !online}
                  onClick={() =>
                    dispatch("accept_changes", {
                      changeIds: record.changes.map((c) => c.id),
                    })
                  }
                >
                  Accept reviewed changes
                </button>
                <small>
                  Existing work is retained. Stop order changes only after
                  acceptance.
                </small>
              </section>
            ) : null}
            {tab === "today" ? (
              <>
                {day.shift.status === "ready" ? (
                  <ClockForm
                    disabled={disabled}
                    onSubmit={(body) => dispatch("clock_in", body)}
                  />
                ) : null}
                {day.shift.status === "loading" ? (
                  <section className={s.card}>
                    <h2>Departure check</h2>
                    <p>Food payment: {pretty(day.paymentStatus)}</p>
                    {PRECHECKS.map(([id, label]) => (
                      <label className={s.check} key={id}>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={!!day.shift.prechecks[id]}
                          onChange={(e) =>
                            dispatch("check_item", {
                              key: id,
                              checked: e.target.checked,
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <InventoryForm
                      items={day.inventory}
                      mode="load"
                      disabled={disabled}
                      onSubmit={(items) => dispatch("confirm_load", { items })}
                    />
                  </section>
                ) : null}
                {day.shift.status === "loaded" ? (
                  <section className={s.card}>
                    <h2>Ready to depart</h2>
                    <button
                      disabled={disabled}
                      onClick={() => dispatch("start_route")}
                    >
                      Start route
                    </button>
                  </section>
                ) : null}
                {day.shift.activeBreak ? (
                  <section className={s.card}>
                    <h2>
                      {day.shift.breaks.at(-1).paid
                        ? "Paid break"
                        : "Unpaid break"}
                    </h2>
                    <button
                      disabled={disabled}
                      onClick={() => setModal({ type: "end_break" })}
                    >
                      End break
                    </button>
                  </section>
                ) : null}
                {day.shift.status === "on_route" && stop ? (
                  <section className={s.property}>
                    <div className={s.propertyBar}>
                      <span>
                        PROPERTY {day.stops.indexOf(stop) + 1} /{" "}
                        {day.stops.length}
                      </span>
                      <b>{stop.arrivedAt ? "Arrival saved" : "Not arrived"}</b>
                    </div>
                    <div className={s.propertyBody}>
                      <h2>{stop.name}</h2>
                      <p>{stop.address}</p>
                      <div className={s.actions}>
                        {!testMode ? <a
                          className={s.secondary}
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.latitude != null && stop.longitude != null ? `${stop.latitude},${stop.longitude}` : stop.address)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Directions
                        </a> : <span>Fictional address</span>}
                        <button
                          className={s.secondary}
                          disabled={
                            disabled ||
                            !!active ||
                            !!day.shift.activeBreak ||
                            stop.tasks.every(taskDone)
                          }
                          onClick={() => setModal({ type: "on_way", stop })}
                        >
                          On my way
                        </button>
                      </div>
                      <div className={s.access}>
                        <b>Access & safety</b>
                        <p>
                          Gate: {stop.gateCode || "Confirm at property"}
                          {stop.communityCode
                            ? ` · Community: ${stop.communityCode}`
                            : ""}
                        </p>
                        <p>
                          Pets: {stop.dogCount ?? "Not supplied"} ·{" "}
                          {stop.safety === "clear"
                            ? "Recorded safe information"
                            : stop.safety === "confirmed"
                              ? "Office clearance recorded"
                              : stop.safety === "unsafe"
                                ? "UNSAFE - do not enter"
                                : "Office clearance required before entry"}
                        </p>
                        <p>
                          {stop.instructions ||
                            "Review service instructions before starting."}
                        </p>
                      </div>
                      {stop.arrivedAt ? (
                        <p className={s.tip}>
                          Arrived {time(stop.arrivedAt)}. One arrival covers
                          every service here.
                        </p>
                      ) : (
                        <button
                          disabled={
                            disabled || !!active || !!day.shift.activeBreak
                          }
                          onClick={() =>
                            dispatch("arrive", { stopId: stop.id })
                          }
                        >
                          I’ve arrived
                        </button>
                      )}
                      <h3>Services at this property</h3>
                      {stop.tasks.map((task) => (
                        <ServiceCard
                          key={`${day.id}:${task.id}`}
                          task={task}
                          stop={stop}
                          now={now}
                          disabled={
                            disabled ||
                            !!day.shift.activeBreak ||
                            (!!active && active.id !== task.id)
                          }
                          expanded={
                            (selectedTask ||
                              active?.id ||
                              stop.tasks.find((t) => !taskDone(t))?.id) ===
                            task.id
                          }
                          onExpand={() => setSelectedTask(task.id)}
                          draft={record.drafts?.[task.id]}
                          onDraft={(value) => draft(task.id, value)}
                          onAction={dispatch}
                          onPhoto={addPhoto}
                          photos={record.photos}
                          onPacing={() => setPacing(true)}
                          onSkip={() => setModal({ type: "skip_task", task })}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                {day.shift.status === "on_route" && !day.shift.activeBreak ? (
                  <div className={s.actions}>
                    <button
                      className={s.secondary}
                      disabled={disabled || !!active}
                      onClick={() => setModal({ type: "start_break" })}
                    >
                      Take a break
                    </button>
                    {summary.accounted === summary.services ? (
                      <button
                        disabled={disabled}
                        onClick={() => dispatch("start_wrap")}
                      >
                        Start wrap-up
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {day.shift.status === "wrapping" ? (
                  <section className={s.card}>
                    <h2>Wrap-up</h2>
                    <p>
                      {clockText(
                        Math.max(
                          0,
                          (now - Date.parse(day.shift.wrapStartedAt)) / 1000,
                        ),
                      )}{" "}
                      elapsed. All time remains recorded.
                    </p>
                    {WRAPCHECKS.map(([id, label]) => (
                      <label className={s.check} key={id}>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={!!day.shift.wrapchecks[id]}
                          onChange={(e) =>
                            dispatch("check_item", {
                              key: id,
                              checked: e.target.checked,
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <InventoryForm
                      items={day.inventory}
                      mode="returns"
                      disabled={disabled}
                      onSubmit={(items) =>
                        setModal({ type: "finish_day", items })
                      }
                    />
                  </section>
                ) : null}
                {day.shift.status === "finished" ? (
                  <section className={s.card}>
                    <h2>Your workday is saved</h2>
                    <p>
                      {summary.completed} completed · {summary.skipped} skipped
                      · {summary.workMiles} work miles
                    </p>
                    <p>
                      {pending
                        ? `${pending} actions await server backup.`
                        : "All captured actions are backed up."}
                    </p>
                    <p>
                      SNG service/payroll upload is blocked until its supported
                      contract is verified. Office reconciliation remains
                      required.
                    </p>
                    <button onClick={() => setTab("activity")}>
                      Review day record
                    </button>
                  </section>
                ) : null}
              </>
            ) : null}
            {tab === "route" ? (
              <>
                <section className={s.card}>
                  <label>
                    Assigned service date
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        void refresh(e.target.value).catch((e) =>
                          setError(e.message),
                        );
                      }}
                    />
                  </label>
                  <p>
                    Future routes are previews. Work stays locked to the
                    assigned service day.
                  </p>
                </section>
                {day.stops.map((item, i) => (
                  <button
                    className={s.routeRow}
                    key={item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setSelectedTask("");
                      setTab("today");
                    }}
                  >
                    <span>{i + 1}</span>
                    <div>
                      <b>{item.name}</b>
                      <small>{item.address}</small>
                      <small>
                        {item.tasks.filter(taskDone).length}/{item.tasks.length}{" "}
                        services accounted
                        {item.recleanOf ? " · Separate return visit" : ""}
                      </small>
                    </div>
                  </button>
                ))}
              </>
            ) : null}
            {tab === "activity" ? (
              <>
                <section className={s.card}>
                  <h2>
                    {pending
                      ? `${pending} actions saved locally`
                      : "Server backup current"}
                  </h2>
                  <p>
                    Clock in: {time(day.shift.clockIn)} · Out:{" "}
                    {time(day.shift.clockOut)}
                  </p>
                  <p>
                    Paid: {hours(summary.paidSeconds)} · Unpaid:{" "}
                    {hours(summary.unpaidSeconds)}
                  </p>
                  <button
                    disabled={!online || syncing}
                    onClick={() => void synchronize()}
                  >
                    Back up now
                  </button>
                  <button className={s.secondary} onClick={exportDay}>
                    Export private recovery copy with photos
                  </button>
                  <small>
                    Contains private customer information. Keep it secure.
                  </small>
                </section>
                {day.issues.map((issue) => (
                  <section className={s.card} key={issue.id}>
                    <h3>{issue.reason}</h3>
                    <p>{issue.notes}</p>
                    <p>{issue.response || "Office review pending"}</p>
                    {issue.response && !issue.acknowledgedAt ? (
                      <button
                        onClick={() =>
                          dispatch("acknowledge", { issueId: issue.id })
                        }
                      >
                        Acknowledge office response
                      </button>
                    ) : null}
                  </section>
                ))}
                {record.messages?.map((message) => (
                  <section className={s.card} key={message.id}>
                    <b>
                      {pretty(message.kind)} · {pretty(message.status)}
                    </b>
                    <p>{message.detail}</p>
                  </section>
                ))}
                {day.stops.map((item) => (
                  <section className={s.card} key={item.id}>
                    <h2>{item.name}</h2>
                    {item.tasks.map((t) => (
                      <div key={t.id}>
                        <b>
                          {t.title} · {pretty(t.status)}
                        </b>
                        <p>
                          {t.quantity} {t.unitLabel} ·{" "}
                          {t.notes || "No private note"}
                          {t.startedAt
                            ? ` · ${clockText(jobTimer(t.startedAt, t.completedAt, t.estimatedMinutes, now).elapsedSeconds)}`
                            : ""}
                        </p>
                        <ProofPhotos photos={t.photos} local={record.photos} />
                      </div>
                    ))}
                  </section>
                ))}
              </>
            ) : null}
            {tab === "more" ? (
              <>
                <section className={s.card}>
                  <h2>Choose a workday</h2>
                  <label>
                    Service date
                    <input
                      type="date"
                      value={date}
                      disabled={
                        pending > 0 ||
                        (!!day.shift.clockIn && !day.shift.clockOut)
                      }
                      onChange={(e) => {
                        setDate(e.target.value);
                        void refresh(e.target.value).catch((error) =>
                          setError(error.message),
                        );
                      }}
                    />
                  </label>
                  <small>
                    Finish the current shift and back up pending work before
                    switching dates. Future workdays are previews.
                  </small>
                </section>
                <section className={s.card}>
                  <h2>Device & backup</h2>
                  <p>
                    To install: in Android Chrome, open the menu and choose
                    Install app or Add to Home screen. On iPhone, open this page
                    in Safari, choose Share, then Add to Home Screen.
                  </p>
                  <p>
                    Open online once and wait for Offline ready. Reconnect and
                    leave the app open to back up. Background uploads while
                    closed are not guaranteed.
                  </p>
                  <p>
                    Device storage can be lost if site data is cleared or the
                    phone is lost. Offline access expires after 12 hours without
                    session verification.
                  </p>
                  <p>
                    GPS navigation opens your preferred maps app. Service timing
                    uses original timestamps and survives screen lock.
                  </p>
                  <button
                    onClick={() =>
                      navigator.storage
                        ?.persist?.()
                        .then((ok) =>
                          setError(
                            ok
                              ? "Persistent storage granted."
                              : "Your browser did not grant persistent storage. Keep server backups current.",
                          ),
                        )
                    }
                  >
                    Request persistent device storage
                  </button>
                </section>
                <section className={s.card}>
                  <h2>Integration status</h2>
                  <p>
                    SNG dispatch imports and completion readback are available
                    through the office. SNG writes and payroll uploads remain
                    blocked. Customer notices require configured Quo transport,
                    current verified recipient preferences and delivery
                    receipts.
                  </p>
                  <a href="/field/pilot/">Finish an earlier pilot shift</a>
                </section>
                {day.shift.clockIn && !day.shift.clockOut ? (
                  <section className={s.card}>
                    <h2>End work with unresolved items</h2>
                    <p>
                      Clock-out records actual paid time and flags incomplete
                      service/inventory for office follow-up.
                    </p>
                    <button
                      className={s.danger}
                      disabled={disabled || !!active || !!day.shift.activeBreak}
                      onClick={() => setModal({ type: "clock_out" })}
                    >
                      Early clock-out / office follow-up
                    </button>
                  </section>
                ) : null}
              </>
            ) : null}
            {active?.timed ? (
              <button
                className={`${s.running} ${jobTimer(active.startedAt, null, active.estimatedMinutes, now).over ? s.over : ""}`}
                onClick={() => setPacing(true)}
              >
                <span>{active.title}</span>
                <b>
                  {clockText(
                    jobTimer(
                      active.startedAt,
                      null,
                      active.estimatedMinutes,
                      now,
                    ).elapsedSeconds,
                  )}
                </b>
              </button>
            ) : null}
          </>
        )}
      </main>
      {day && !locked ? (
        <nav className={s.nav} aria-label="Technician navigation">
          {[
            ["today", "Today"],
            ["route", "Route"],
            ["activity", "Activity"],
            ["more", "More"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => {
                setTab(id);
                window.scrollTo({ top: 0, behavior: "instant" });
              }}
            >
              {label}
              {id === "activity" && pending ? ` (${pending})` : ""}
            </button>
          ))}
        </nav>
      ) : null}
      {modal ? (
        <ActionDialog
          modal={modal}
          customerTextsEnabled={record?.customerTextsEnabled === true}
          disabled={disabled}
          onClose={() => setModal(null)}
          onSubmit={async (body) => {
            if (await dispatch(modal.type, body)) setModal(null);
          }}
        />
      ) : null}
      {pacing && active?.timed ? (
        <PacingView
          task={active}
          stop={activeStop}
          timer={jobTimer(active.startedAt, null, active.estimatedMinutes, now)}
          onClose={() => setPacing(false)}
        />
      ) : null}
    </div>
  );
}
function Login({ onLogin }) {
  const { sessionAPI, testMode } = useContext(Environment);
  const [email, setEmail] = useState(""),
    [pin, setPin] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className={s.card}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await request(sessionAPI, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(testMode ? { operation: "start" } : { email, pin }),
          });
          setPin("");
          await onLogin();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>{testMode ? "Start a training day" : "Technician sign in"}</h1>
      <p>
        Use your individual OPWP account. Pending device work is retained across
        reauthentication.
      </p>
      {!testMode ? <><label>
        Email
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Six-digit PIN
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          required
        />
      </label>
      </> : <p>Fictional customers only. No real PIN required.</p>}
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy}>{testMode ? "Start test day" : "Sign in"}</button>
    </form>
  );
}
function ClockForm({ disabled, onSubmit }) {
  const [mileage, setMileage] = useState(""),
    [vehicle, setVehicle] = useState("company");
  return (
    <form
      className={s.card}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ mileage: Number(mileage), vehicle, notes: "" });
      }}
    >
      <h2>Clock in before loading</h2>
      <label>
        Full odometer
        <input
          type="number"
          min="0"
          max="9999999"
          inputMode="decimal"
          required
          value={mileage}
          onChange={(e) => setMileage(e.target.value)}
        />
      </label>
      <label>
        Vehicle
        <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
          <option value="company">Company vehicle</option>
          <option value="personal">Personal vehicle</option>
        </select>
      </label>
      <button disabled={disabled}>Clock in</button>
    </form>
  );
}
function InventoryForm({ items, mode, disabled, onSubmit }) {
  const [counts, setCounts] = useState({});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          items.map((i) =>
            mode === "load"
              ? {
                  productId: i.productId,
                  quantity: counts[i.productId]?.quantity ?? i.required,
                }
              : {
                  productId: i.productId,
                  returned:
                    counts[i.productId]?.returned ?? i.loaded - i.delivered,
                  damaged: counts[i.productId]?.damaged ?? 0,
                  missing: counts[i.productId]?.missing ?? 0,
                },
          ),
        );
      }}
    >
      {items.map((i) => (
        <fieldset key={i.productId}>
          <legend>
            {i.name} · {i.color}
          </legend>
          <p>
            {mode === "load"
              ? `${i.required} required`
              : `${i.loaded - i.delivered} undelivered`}
          </p>
          {(mode === "load"
            ? ["quantity"]
            : ["returned", "damaged", "missing"]
          ).map((k) => (
            <label key={k}>
              {pretty(k)}
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="200"
                required
                value={
                  counts[i.productId]?.[k] ??
                  (k === "quantity"
                    ? i.required
                    : k === "returned"
                      ? i.loaded - i.delivered
                      : 0)
                }
                onChange={(e) =>
                  setCounts({
                    ...counts,
                    [i.productId]: {
                      ...counts[i.productId],
                      [k]: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </fieldset>
      ))}
      <button disabled={disabled}>
        {mode === "load" ? "Confirm load" : "Continue to clock-out"}
      </button>
    </form>
  );
}
function ServiceCard({
  task,
  stop,
  now,
  disabled,
  expanded,
  onExpand,
  draft,
  onDraft,
  onAction,
  onPhoto,
  photos,
  onPacing,
  onSkip,
}) {
  const { testMode } = useContext(Environment);
  const [safe, setSafe] = useState(false),
    [secured, setSecured] = useState(false),
    [units, setUnits] = useState(false),
    [notes, setNotes] = useState(draft ?? task.notes),
    [purpose, setPurpose] = useState(
      task.proofKind === "none" ? "observation" : task.proofKind,
    );
  const timer = jobTimer(
      task.startedAt,
      task.completedAt,
      task.estimatedMinutes,
      now,
    ),
    done = taskDone(task);
  function updateNote(value) {
    setNotes(value);
    onDraft(value);
  }
  return (
    <article
      className={`${s.service} ${done ? s.done : task.status === "working" ? s.working : ""}`}
    >
      <button
        className={s.serviceTitle}
        aria-expanded={expanded}
        onClick={onExpand}
      >
        <b>{task.title}</b>
        <span>
          {pretty(task.status).toUpperCase()} · {task.quantity} {task.unitLabel}
          {task.timed ? ` · ${task.estimatedMinutes} min` : ""}
        </span>
      </button>
      {expanded ? (
        <div className={s.serviceBody}>
          {task.instructions ? <p>{task.instructions}</p> : null}
          {task.placementNote ? (
            <p>
              <b>Placement:</b> {task.placementNote}
            </p>
          ) : null}
          {done ? (
            <>
              <p>
                {task.notes || task.reason || "Recorded"}
                {task.startedAt ? ` · ${clockText(timer.elapsedSeconds)}` : ""}
              </p>
              <ProofPhotos photos={task.photos} local={photos} />
            </>
          ) : task.status === "working" ? (
            <>
              {task.timed ? (
                <button
                  className={`${s.timer} ${timer.over ? s.over : ""}`}
                  onClick={onPacing}
                >
                  <b>{clockText(timer.elapsedSeconds)}</b>
                  <span>
                    {timer.over
                      ? `+${clockText(timer.overtimeSeconds)} over allowance`
                      : `${clockText(Math.max(0, timer.allottedSeconds - timer.elapsedSeconds))} remaining`}
                  </span>
                </button>
              ) : null}
              <label>
                Private office note
                <textarea
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => updateNote(e.target.value)}
                />
              </label>
              <button
                className={s.textButton}
                disabled={disabled}
                onClick={() =>
                  onAction("save_note", { taskId: task.id, notes })
                }
              >
                Save private note
              </button>
              <VoiceNote value={notes} onChange={updateNote} />
              <ProofPhotos photos={task.photos} local={photos} />
              <label>
                Photo purpose
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                >
                  <option value="observation">Office observation</option>
                  <option value="gate">Latched gate</option>
                  <option value="service">Service proof</option>
                  {task.serviceId === "food" ? (
                    <option value="delivery">Delivery proof</option>
                  ) : null}
                </select>
              </label>
              <label className={s.photoButton}>
                Add camera / gallery photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={disabled || task.photos.length >= 8}
                  onChange={(e) => {
                    if (e.target.files?.[0])
                      onPhoto(task, e.target.files[0], purpose);
                    e.target.value = "";
                  }}
                />
              </label>
              {testMode ? <button disabled={disabled || task.photos.length >= 8} onClick={async () => {
                const canvas = document.createElement("canvas"); canvas.width=640; canvas.height=360;
                const ctx=canvas.getContext("2d"); ctx.fillStyle="#123d32";ctx.fillRect(0,0,640,360);
                ctx.fillStyle="#fff";ctx.font="bold 30px sans-serif";ctx.fillText("TRAINING PHOTO",35,80);
                ctx.font="20px sans-serif";ctx.fillText("Fictional service - " + purpose,35,145);ctx.fillText("Not customer evidence",35,195);
                const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.75));
                if(blob) await onPhoto(task,new File([blob],"training-proof.jpg",{type:"image/jpeg"}),purpose);
              }}>Use sample proof</button> : null}
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={units}
                  onChange={(e) => setUnits(e.target.checked)}
                />
                All {task.quantity} {task.unitLabel} serviced
              </label>
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={secured}
                  onChange={(e) => setSecured(e.target.checked)}
                />
                {task.serviceId === "food"
                  ? "Delivery placed as instructed"
                  : "Property and gate secured"}
              </label>
              <button
                disabled={disabled || !secured || !units}
                onClick={() =>
                  onAction("complete_task", {
                    taskId: task.id,
                    secured: true,
                    units: task.quantity,
                    notes,
                  })
                }
              >
                Complete service
              </button>
            </>
          ) : (
            <>
              {task.entryRequired ? (
                <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={safe}
                    onChange={(e) => setSafe(e.target.checked)}
                  />
                  I checked access and it is safe to enter
                </label>
              ) : null}
              <button
                disabled={
                  disabled ||
                  !stop.arrivedAt ||
                  (task.entryRequired &&
                    (!safe || ["unsafe", "unknown"].includes(stop.safety)))
                }
                onClick={() =>
                  onAction("start_task", { taskId: task.id, safe })
                }
              >
                Start service
              </button>
            </>
          )}
          {!done ? (
            <button
              className={s.textButton}
              disabled={disabled}
              onClick={onSkip}
            >
              Can’t service? Skip / report issue
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
function ProofPhotos({ photos, local }) {
  const { API } = useContext(Environment);
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const items = photos.map((p) => ({
      ...p,
      url: local[p.id]
        ? URL.createObjectURL(local[p.id])
        : `${API}photo/?id=${p.id}`,
    }));
    setUrls(items);
    return () =>
      items.forEach((p) => {
        if (p.url.startsWith("blob:")) URL.revokeObjectURL(p.url);
      });
  }, [photos, local, API]);
  return urls.length ? (
    <div className={s.photos}>
      {urls.map((p) => (
        <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
          <img src={p.url} alt={`${p.purpose} proof`} />
          <small>{p.purpose}</small>
        </a>
      ))}
    </div>
  ) : null;
}
function VoiceNote({ value, onChange }) {
  const [status, setStatus] = useState("");
  return (
    <>
      <button
        className={s.textButton}
        type="button"
        onClick={() => {
          const Recognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;
          if (!Recognition) {
            setStatus(
              "Use the phone keyboard microphone; browser dictation is unavailable.",
            );
            return;
          }
          const r = new Recognition();
          r.lang = "en-US";
          r.onresult = (e) => {
            const sentence = e.results[0][0].transcript;
            onChange(
              `${value ? `${value.trim()} ` : ""}${sentence}`.slice(0, 2000),
            );
            setStatus("Review the dictated note before saving.");
          };
          r.onerror = () =>
            setStatus(
              "Dictation unavailable. Type or use the keyboard microphone.",
            );
          r.onend = () => setStatus("Dictation ended. Review the note.");
          r.start();
          setStatus("Listening. Browser dictation may require internet.");
        }}
      >
        Dictate note
      </button>
      {status ? <small role="status">{status}</small> : null}
    </>
  );
}
function ActionDialog({
  modal,
  disabled,
  onClose,
  onSubmit,
  customerTextsEnabled,
}) {
  const ref = useRef(null),
    [mileage, setMileage] = useState(""),
    [notes, setNotes] = useState(""),
    [reason, setReason] = useState("Locked gate"),
    [breakType, setBreakType] = useState("paid"),
    [minutes, setMinutes] = useState(15),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const needsMileage = [
    "start_break",
    "end_break",
    "finish_day",
    "clock_out",
  ].includes(modal.type);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            taskId: modal.task?.id,
            stopId: modal.stop?.id,
            mileage: Number(mileage),
            notes,
            reason,
            breakType,
            minutes,
            confirm,
            confirmMileage: confirm,
            items: modal.items,
          });
        }}
      >
        <button className={s.textButton} type="button" onClick={onClose}>
          Close
        </button>
        <h2>{pretty(modal.type)}</h2>
        {modal.type === "on_way" && !customerTextsEnabled ? (
          <p>
            Customer texts are currently off. This saves an arrival estimate for
            the office; it will not text the customer.
          </p>
        ) : null}
        {modal.type === "on_way" ? (
          <label>
            Estimated arrival
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {ETA_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} minutes
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {modal.type === "start_break" ? (
          <label>
            Break policy
            <select
              value={breakType}
              onChange={(e) => setBreakType(e.target.value)}
            >
              {BREAK_TYPES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {modal.type === "skip_task" ? (
          <label>
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {[
                "Locked gate",
                "Unsafe animal",
                "Weather",
                "Customer request",
                "Equipment",
                "Other",
              ].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        ) : null}
        {needsMileage ? (
          <label>
            Full odometer
            <input
              type="number"
              min="0"
              max="9999999"
              inputMode="decimal"
              value={mileage}
              required
              onChange={(e) => setMileage(e.target.value)}
            />
          </label>
        ) : null}
        {modal.type !== "on_way" ? (
          <label>
            Private office note
            <textarea
              maxLength={2000}
              value={notes}
              required={["skip_task", "clock_out"].includes(modal.type)}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        ) : null}
        <label className={s.check}>
          <input
            type="checkbox"
            checked={confirm}
            required
            onChange={(e) => setConfirm(e.target.checked)}
          />
          I reviewed this action
          {needsMileage ? " and verified the odometer" : ""}.
        </label>
        <button disabled={disabled}>Save {pretty(modal.type)}</button>
      </form>
    </dialog>
  );
}
