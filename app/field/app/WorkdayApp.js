"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  activeService,
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
import { layoutRouteMarkers } from "./route-map-layout.mjs";
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
const taskUnits = (task) => task.quantity + " " + (task.quantity === 1 ? task.unitLabel : task.unitLabel === "box" ? "boxes" : task.unitLabel === "delivery" ? "deliveries" : task.unitLabel.endsWith("s") ? task.unitLabel : task.unitLabel + "s");
const serviceName = (task) => task.serviceId === "scoop" ? "Yard cleanup" : task.serviceId === "food" ? "Dog food delivery" : task.serviceId === "litter" ? "Kitty litter service" : task.title;
function FieldIcon({ name, size = 20 }) {
  const paths = {
    route: "M5 6a2 2 0 1 0 0 .01M19 18a2 2 0 1 0 0 .01M7 6h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h8",
    today: "M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1M8 14h3m-3 3h6",
    activity: "M4 5h16M4 12h16M4 19h16M8 3v4m8 3v4M9 17v4",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    check: "m5 12 4 4L19 6",
    back: "m14 6-6 6 6 6",
    clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    camera: "M3 7h4l2-3h6l2 3h4v13H3V7Zm13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    bag: "M5 7h14l2 14H3L5 7Zm3 0V5a4 4 0 0 1 8 0v2",
    alert: "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
    shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.route} /></svg>;
}

function FoodWorkSummary({ stop, inventory }) {
  const items = stop.tasks.filter((task) => task.serviceId === "food").flatMap((task) => task.deliveryItems.map((item) => ({ ...item, key: `${task.id}:${item.productId}`, name: inventory.find((product) => product.productId === item.productId)?.name || "Scheduled dog food" })));
  return items.length ? <div className={s.foodWorkSummary}><FieldIcon name="bag" size={18} /><div>{items.map((item) => <span key={item.key}>{item.quantity} x {item.name}</span>)}</div></div> : null;
}

function RouteOverview({ day, summary, onSelect, mode = "all" }) {
  const mapHeight = mode === "map" ? 410 : 250;
  const located = layoutRouteMarkers(day.stops, mapHeight);
  const next = day.stops.find((stop) => !stop.tasks.every(taskDone));
  const percent = summary.stops ? Math.round(summary.stopsFinished / summary.stops * 100) : 0;
  return <section className={`${s.routeOverview} ${mode === "map" ? s.mapView : ""}`}>
    {mode !== "list" ? <div className={s.mapCard}>
      <div className={s.mapHeading}><span><FieldIcon name="route" size={17} /> Assigned stop map</span><span>{day.stops.length} stops</span></div>
      {located.length ? <svg className={s.routeMap} viewBox={`0 0 560 ${mapHeight}`} role="img" aria-label="Assigned stop coordinates in route order. Lines connect stops directly and do not represent roads.">
        <defs><pattern id="field-map-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#e4e5e7" strokeWidth="1" /></pattern></defs>
        <rect width="560" height={mapHeight} fill="#f5f5f4" /><rect width="560" height={mapHeight} fill="url(#field-map-grid)" />
        <text x="20" y="28" className={s.mapRegion}>NORTHWEST OHIO</text><text x="529" y="28" className={s.mapNorth}>N</text>
        <polyline points={located.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke="#6d727a" strokeWidth="2.5" strokeDasharray="5 4" strokeLinejoin="round" />
        {located.map(({ stop, index, x, y }) => { const done = stop.tasks.every(taskDone); return <g key={stop.id} className={s.mapPin} tabIndex="0" role="button" aria-label={`Open stop ${index + 1}, ${stop.name}`} onClick={() => onSelect(stop)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(stop); } }}><title>{index + 1}. {stop.name}: {stop.address}</title><circle cx={x} cy={y} r="38" fill="transparent" pointerEvents="all" /><circle cx={x} cy={y} r="16" fill={done ? "#747981" : stop.id === next?.id ? "#BB0000" : "#25282e"} stroke="white" strokeWidth="3" /><text x={x} y={y + 4.5} textAnchor="middle" fill="white" fontSize="12" fontWeight="700">{done ? "✓" : index + 1}</text></g>; })}
      </svg> : <div className={s.mapUnavailable}>Stop map unavailable. The office has not supplied coordinates.</div>}
      <div className={s.mapCaption}>Straight-line overview. Use Directions for road navigation.</div>
    </div> : null}
    <div className={s.routeProgress}><div><b>{summary.stopsFinished} of {summary.stops} stops finished</b><span>{percent}%</span></div><progress max="100" value={percent} aria-label="Route progress" /></div>
    {mode !== "map" ? <><div className={s.listHeading}><h2>Today's stops</h2><span>Assigned order</span></div>
    <div className={s.stopList}>{day.stops.map((stop, index) => {
      const done = stop.tasks.every(taskDone), current = stop.id === next?.id, unsafe = ["unsafe", "unknown"].includes(stop.safety);
      return <button className={`${s.routeRow} ${current ? s.nextStop : ""} ${done ? s.finishedStop : ""}`} key={stop.id} onClick={() => onSelect(stop)}>
        <span className={s.stopNumber}>{done ? <FieldIcon name="check" size={17} /> : index + 1}</span>
        <div className={s.stopSummary}><div className={s.stopName}><b>{stop.name}</b><span className={`${s.statusBadge} ${unsafe ? s.unsafeBadge : ""}`}>{done ? "Finished" : unsafe ? "Safety review" : stop.arrivedAt ? "Arrived" : current ? "Next stop" : "Scheduled"}</span></div><small>{stop.address}</small><div className={s.workTags}>{stop.tasks.map((task) => <span key={task.id} className={task.serviceId === "food" ? s.foodTag : ""}>{task.serviceId === "food" ? <FieldIcon name="bag" size={13} /> : null}{serviceName(task)}{task.quantity > 1 ? ` (${task.quantity})` : ""}</span>)}</div><FoodWorkSummary stop={stop} inventory={day.inventory} /><small className={s.stopMeta}>{stop.dogCount != null ? `${stop.dogCount} ${stop.dogCount === 1 ? "dog" : "dogs"}` : "Dog count not supplied"}{stop.travelMinutes != null ? ` · ${Math.round(stop.travelMinutes)} min drive` : ""}{stop.recleanOf ? " · Return visit" : ""}</small></div>
        <span className={s.rowChevron} aria-hidden="true">›</span>
      </button>;
    })}</div></> : null}
  </section>;
}
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
    [detailTab, setDetailTab] = useState("overview"),
    [detailView, setDetailView] = useState("overview"),
    [preparing, setPreparing] = useState(false),
    [date, setDate] = useState(operatingDate()),
    [modal, setModal] = useState(null),
    [pacing, setPacing] = useState(false),
    [now, setNow] = useState(Date.now());
  const account = useRef(""),
    syncLock = useRef(false),
    mutationLock = useRef(false),
    recordRef = useRef(null),
    syncFn = useRef(null),
    initialView = useRef(false);
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
      if (["start_wrap", "finish_day"].includes(type)) {
        const current = recordRef.current?.day;
        const incompleteProof = current?.stops.some((item) => item.tasks.some((task) => task.status === "completed" && !proofReady(item, task)));
        if (safetyBlocked(current) || incompleteProof) throw new Error("Resolve safety items and required photos before closing this route.");
      }
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
      return await dispatch(
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
    activeStop = day?.stops.find((item) => item.tasks.some((task) => task.id === active?.id)),
    stop = day?.stops.find((item) => item.id === selected) || activeStop || day?.stops.find((item) => !item.tasks.every(taskDone)) || day?.stops.at(-1),
    leaseExpired = record && (!Number.isFinite(Date.parse(record.offlineUntil)) || Date.parse(record.offlineUntil) <= now),
    pending = record?.pending.length || 0,
    privacyHeld = record?.privacyHolds?.length || 0,
    safetyHold = safetyBlocked(day),
    disabled = busy || privacyHeld > 0 || leaseExpired || locked || record?.sourceChanged || day?.date > operatingDate(),
    chosenTask = stop?.tasks.find((task) => task.id === selectedTask) || stop?.tasks.find((task) => task.id === active?.id) || stop?.tasks.find((task) => !taskDone(task)) || stop?.tasks.at(-1),
    routeLocked = disabled || day?.shift.status !== "on_route" || !!day?.shift.activeBreak,
    proofCount = day?.stops.reduce((count, item) => count + item.tasks.reduce((n, task) => n + task.photos.length, 0), 0) || 0,
    missingProof = day?.stops.flatMap((item) => item.tasks.filter((task) => task.status === "completed" && !proofReady(item, task))).length || 0,
    safetyStop = day?.stops.find((item) => item.id === modal?.stop?.id),
    safetyTask = safetyStop?.tasks.find((item) => item.id === modal?.task?.id);
  useEffect(() => {
    if (!record?.day || initialView.current) return;
    initialView.current = true;
    const query = new URLSearchParams(window.location.search), view = query.get("view");
    const item = record.day.stops.find((entry) => entry.id === query.get("stopId")) || record.day.stops.find((entry) => !entry.tasks.every(taskDone)) || record.day.stops[0];
    if (view === "map") setTab("route");
    else if (["closeout", "activity", "more"].includes(view)) setTab(view);
    else if (["stop", "proof", "complete", "safety"].includes(view) && item) {
      const task = item.tasks.find((entry) => entry.id === query.get("taskId")) || item.tasks.find((entry) => !taskDone(entry)) || item.tasks[0];
      setSelected(item.id); setSelectedTask(task?.id || "");
      setDetailView(view === "proof" || view === "complete" ? view : "overview");
      if (view === "safety" && task) setModal({ type: "skip_task", safety: true, stop: item, task });
    }
  }, [record?.day?.id]);
  function openStop(item, view = "overview") {
    setSelected(item.id); setSelectedTask(""); setDetailTab("overview"); setDetailView(view); setTab("today");
    window.history.replaceState(null, "", "?" + new URLSearchParams({ view: view === "overview" ? "stop" : view, stopId: item.id }));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function openTab(value) {
    setTab(value); setSelected(""); setDetailTab("overview"); setDetailView("overview");
    window.history.replaceState(null, "", "?view=" + (value === "today" ? "route" : value === "route" ? "map" : value));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function nextStop() {
    const current = recordRef.current?.day?.stops.find((item) => item.id === selected);
    const next = current && !current.tasks.every(taskDone) ? current : recordRef.current?.day?.stops.find((item) => !item.tasks.every(taskDone));
    if (next) openStop(next); else openTab("closeout");
  }
  function reportSafety() {
    if (stop && chosenTask && !taskDone(chosenTask)) setModal({ type: "skip_task", safety: true, stop, task: chosenTask });
  }
  async function startRoute() {
    if (day.shift.status === "loaded") {
      if (await dispatch("start_route")) { setPreparing(false); openTab("route"); }
    } else setPreparing(true);
  }
  async function startCloseout() {
    if (!navigator.onLine) { setError("Reconnect to sync and close your route. Completed work and photos stay saved on this device."); return; }
    await synchronize();
    if (recordRef.current?.pending.length) { setError("Sync the remaining actions before closing the route."); return; }
    if (await dispatch("start_wrap")) openTab("closeout");
  }
  const safetyScreen = modal?.safety === true;
  const easternHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
  const greeting = easternHour < 12 ? "Good morning" : easternHour < 17 ? "Good afternoon" : "Good evening";
  const next = day?.stops.find((item) => !item.tasks.every(taskDone));
  return <div className={`opwp-field-shell ${s.shell}`}>
    <header className={s.header}><img src="/assets/opwp-logo.webp" alt="" /><div><b>Ohio Pet Waste Pros</b><span>Route OS · Field</span></div>{day ? <span className={s.techAvatar}>{day.memberName?.slice(0, 1)}</span> : null}<button onClick={logout} disabled={!record || pending > 0}>Sign out</button></header>
    <div className={`${s.connection} ${!online || syncError ? s.warning : ""}`} role="status"><b><i className={!online || syncError ? s.connectionHold : ""} />{!online ? "Offline · work saved here" : syncing ? "Syncing your work" : syncError ? "Sync needs attention" : pending ? pending + " changes queued" : "All changes synced"}</b><span>{ready ? "Offline ready" : "Preparing offline access"}</span></div>
    <main className={s.main}>
      {error ? <p className={s.error} role="alert">{error}</p> : null}
      {syncError ? <p className={s.tip}>{syncError} <button onClick={() => void synchronize()}>Retry sync</button></p> : null}
      {privacyHeld ? <div className={s.error} role="alert">{privacyHeld} saved actions need office review after a privacy update. Your service records and photos are retained. <button onClick={exportDay}>Export recovery copy</button></div> : null}
      {loading ? <section className={s.card}><h1>Opening your route</h1><p>Checking your assigned workday.</p></section> : locked ? <Login onLogin={async () => { try { await refresh(); void synchronize(); } catch (problem) { setError(problem.message); } }} /> : leaseExpired ? <section className={s.card}><h1>Sign in online again</h1><p>Your offline access window has ended. Pending work is still saved on this device.</p><button onClick={() => void synchronize()}>Verify session</button><button className={s.secondary} onClick={exportDay}>Export recovery copy</button></section> : !day ? <section className={s.card}><h1>No released route</h1><p>The office must release an assigned route before work can start.</p><label>Service date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); void refresh(event.target.value).catch((problem) => setError(problem.message)); }} /></label><button onClick={() => void refresh().catch((problem) => setError(problem.message))}>Refresh assignment</button><a href="/field/pilot/">Earlier pilot shift</a></section> : <>
        {record.sourceChanged ? <section className={`${s.card} ${s.attention}`}><h2>Office review required</h2><p>Your dispatch assignment has changed. Contact the office before continuing. Saved work is retained.</p><button onClick={exportDay}>Export recovery copy</button></section> : null}
        {record.changes?.length ? <details className={s.officeUpdates}><summary><span className={s.updateMark} aria-hidden="true">!</span><span>{record.changes.length} office update{record.changes.length === 1 ? "" : "s"} to review</span><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary><div className={s.officeUpdateBody}>{record.changes.map((change) => <p key={change.id}><b>{pretty(change.kind)}</b>: {change.payload.reason || change.payload.text}</p>)}<button disabled={disabled || !!active || pending > 0 || !online} onClick={() => dispatch("accept_changes", { changeIds: record.changes.map((change) => change.id) })}>Accept reviewed changes</button><small>Stop order changes only after you accept the update.</small></div></details> : null}
        {safetyScreen ? safetyStop && safetyTask ? <SafetyReport stop={safetyStop} task={safetyTask} disabled={routeLocked || !!active && active.id !== safetyTask.id || taskDone(safetyTask)} onClose={() => setModal(null)} onSubmit={async (body) => { if (await dispatch("skip_task", { ...body, taskId: safetyTask.id, reason: "Unsafe animal", confirm: true })) { setModal(null); setDetailTab("history"); } }} /> : <section className={s.card}><h2>This service is no longer assigned</h2><p>Return to your current route to review available work.</p><button onClick={() => { setModal(null); openTab("today"); }}>Return to route</button></section> : tab === "today" && selected && stop ? <>
          <button className={s.backLink} onClick={() => openTab("today")}><FieldIcon name="back" size={17} /> Today's stops</button>
          {!["proof", "complete"].includes(detailView) ? <><div className={s.stopPageHeading}><span className={s.eyebrow}>STOP {day.stops.indexOf(stop) + 1} OF {day.stops.length}</span><span className={`${s.statusBadge} ${["unsafe", "unknown"].includes(stop.safety) ? s.unsafeBadge : ""}`}>{stop.tasks.every(taskDone) ? "Finished" : stop.arrivedAt ? "Arrived" : "Scheduled"}</span><h1>{stop.name}</h1><p>{stop.address}</p></div>
          <div className={s.detailTabs} role="tablist" aria-label="Stop information">{["overview", "notes", "history"].map((value) => <button key={value} role="tab" aria-selected={detailTab === value} onClick={() => { setDetailTab(value); setDetailView("overview"); }}>{pretty(value)}</button>)}</div>
          {stop.tasks.length > 1 ? <div className={s.serviceChooser} aria-label="Scheduled services">{stop.tasks.map((task) => <button key={task.id} className={chosenTask?.id === task.id ? s.chosenService : ""} onClick={() => { setSelectedTask(task.id); setDetailView("overview"); }}>{taskDone(task) ? <FieldIcon name="check" size={15} /> : null}{serviceName(task)}</button>)}</div> : null}
          </> : <div className={s.workflowContext}><b>{stop.name}</b><span>Stop {day.stops.indexOf(stop) + 1} of {day.stops.length}</span></div>}
          {chosenTask ? <ServiceWorkflow key={day.id + ":" + chosenTask.id} task={chosenTask} stop={stop} day={day} section={detailTab} initialStage={detailView} onStageChange={setDetailView} now={now} disabled={routeLocked || !!active && active.id !== chosenTask.id} draft={record.drafts?.[chosenTask.id]} photos={record.photos} onDraft={(value) => draft(chosenTask.id, value)} onAction={dispatch} onPhoto={addPhoto} onPacing={() => setPacing(true)} onSkip={() => setModal({ type: "skip_task", task: chosenTask, stop })} onEta={() => setModal({ type: "on_way", stop })} onSafety={reportSafety} onNext={nextStop} /> : null}
        </> : tab === "today" ? <>
          <div className={s.todayHeading}><p>{new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p><h1>{greeting}, {day.memberName?.split(" ")[0]}.</h1></div>
          <div className={s.heroStats}><div><FieldIcon name="pin" /><b>{day.stops.length}</b><span>Stops today</span></div><div><FieldIcon name="check" /><b>{summary.stopsFinished}</b><span>Completed</span></div><div><FieldIcon name="clock" /><b>{Math.round(day.stops.reduce((count, item) => count + (item.travelMinutes || 0) + item.tasks.reduce((n, task) => n + (task.estimatedMinutes || 0), 0), 0))}<small> min</small></b><span>Planned time</span></div></div>
          <div className={s.routeStatusCard}><div><span className={s.eyebrow}>{day.shift.status === "finished" ? "ROUTE FINISHED" : day.shift.status === "on_route" ? "YOUR ROUTE IS IN PROGRESS" : "READY WHEN YOU ARE"}</span><h2>{day.shift.status === "finished" ? "Every visit accounted for." : day.shift.status === "on_route" ? summary.stops - summary.stopsFinished + " stops to go" : "A clear plan for the day."}</h2><p>{day.shift.clockIn ? "Clocked in at " + time(day.shift.clockIn) + " · " + hours(summary.paidSeconds) + " recorded" : "Clock in and complete your load check before heading out."}</p></div><FieldIcon name="route" size={34} /></div>
          {["ready", "loading", "loaded"].includes(day.shift.status) ? <button className={s.bigPrimary} disabled={disabled} onClick={startRoute}>Start route <FieldIcon name="route" size={19} /></button> : <div className={s.todayActions}><button className={s.bigPrimary} onClick={() => activeStop ? openStop(activeStop) : next ? openStop(next) : openTab("closeout")}>{activeStop ? "Resume current service" : next ? "Open next stop" : day.shift.status === "wrapping" ? "Finish route" : "Review route closeout"}</button></div>}
          {day.shift.activeBreak ? <section className={s.card}><h2>You're on a break</h2><p>{day.shift.breaks.at(-1).paid ? "Paid break" : "Unpaid break"} started at {time(day.shift.breaks.at(-1).startedAt)}.</p><button disabled={disabled} onClick={() => setModal({ type: "end_break" })}>End break</button></section> : null}
          <RouteOverview day={day} summary={summary} onSelect={openStop} mode="list" />
        </> : tab === "route" ? <>
          <div className={s.pageHeading}><span className={s.eyebrow}>TODAY'S ROUTE</span><h1>On the move.</h1><p>{summary.stopsFinished} of {summary.stops} stops finished · {summary.services - summary.accounted} services remaining</p></div>
          <RouteOverview day={day} summary={summary} onSelect={openStop} mode="map" />
          {next ? <section className={s.nextStopCard}><span className={s.eyebrow}>UP NEXT</span><h2>{next.name}</h2><p>{next.address}</p><FoodWorkSummary stop={next} inventory={day.inventory} /><div className={s.mapActions}><button onClick={() => openStop(next)}>Open stop</button><MapLink stop={next} testMode={testMode} /></div></section> : <button className={s.bigPrimary} onClick={() => openTab("closeout")}>Review route closeout</button>}
          {["ready", "loading", "loaded"].includes(day.shift.status) ? <button className={s.bigPrimary} disabled={disabled} onClick={startRoute}>Start route</button> : null}
          <p className={s.tip}>GPS technician tracking: Not built yet. Stop positions and service progress are saved for offline use.</p>
        </> : tab === "closeout" ? <CloseoutReview day={day} summary={summary} pending={pending} proofCount={proofCount} missingProof={missingProof} safetyHold={safetyHold} online={online} disabled={disabled || !!active || !!day.shift.activeBreak} onStart={startCloseout} onCheck={(key, checked) => dispatch("check_item", { key, checked })} onFinish={(items) => setModal({ type: "finish_day", items })} onSync={synchronize} onViewStop={openStop} onBack={() => openTab("today")} /> : tab === "activity" ? <>
          <div className={s.pageHeading}><span className={s.eyebrow}>YOUR WORKDAY</span><h1>Activity and updates</h1><p>Visit records, saved photos and office responses.</p></div>
          <div className={s.heroStats}><div><b>{summary.completed}</b><span>Services complete</span></div><div><b>{proofCount}</b><span>Photos saved</span></div><div><b>{pending}</b><span>Queued changes</span></div></div>
          {day.issues.map((issue) => <section className={`${s.card} ${!issue.response ? s.attention : ""}`} key={issue.id}><span className={s.eyebrow}>{issue.response ? "OFFICE RESPONSE" : "AWAITING OFFICE REVIEW"}</span><h2>{issue.reason === "Unsafe animal" ? "Safety report" : issue.reason}</h2><p>{issue.notes}</p><p>{issue.response || "Your report is saved. The office has not responded yet."}</p>{issue.response && !issue.acknowledgedAt ? <button disabled={disabled} onClick={() => dispatch("acknowledge", { issueId: issue.id })}>Acknowledge response</button> : null}</section>)}
          {day.stops.map((item) => <section className={s.card} key={item.id}><h2>{item.name}</h2>{item.tasks.map((task) => <div className={s.activityTask} key={task.id}><b>{serviceName(task)}</b><span className={s.statusBadge}>{pretty(task.status)}</span><p>{task.completedAt ? "Recorded at " + time(task.completedAt) : task.startedAt ? "Started at " + time(task.startedAt) : "Not started"}{task.notes ? " · " + task.notes : ""}</p><ProofPhotos photos={task.photos} local={record.photos} /></div>)}</section>)}
          {record.messages?.map((message) => <section className={s.card} key={message.id}><b>{pretty(message.kind)} · {pretty(message.status)}</b><p>{message.detail}</p></section>)}
        </> : <>
          <div className={s.pageHeading}><span className={s.eyebrow}>FIELD TOOLS</span><h1>Your workday</h1><p>Breaks, sync, dates and device settings.</p></div>
          <section className={s.card}><h2>Route controls</h2><button className={s.bigPrimary} onClick={() => openTab("closeout")}>Review end of route</button>{day.shift.status === "on_route" ? <button className={s.secondary} disabled={disabled || !!active} onClick={() => setModal({ type: day.shift.activeBreak ? "end_break" : "start_break" })}>{day.shift.activeBreak ? "End break" : "Take a break"}</button> : null}</section>
          <section className={s.card}><h2>Sync and device</h2><p>{pending ? pending + " actions are waiting to sync." : "Your saved work is up to date."}</p><button disabled={!online || syncing} onClick={() => void synchronize()}>Sync now</button><button className={s.secondary} onClick={exportDay}>Export private recovery copy</button><small>Recovery files contain private service information. Keep them secure.</small><p>Open the app online and wait for Offline ready before leaving coverage. Photos and service actions queue on this device until you reconnect.</p><button className={s.textButton} onClick={() => navigator.storage?.persist?.().then((ok) => setError(ok ? "Persistent storage granted." : "Your browser did not grant persistent storage. Keep synced copies current."))}>Request persistent storage</button></section>
          <section className={s.card}><h2>Choose a workday</h2><label>Service date<input type="date" value={date} disabled={pending > 0 || !!day.shift.clockIn && !day.shift.clockOut} onChange={(event) => { setDate(event.target.value); void refresh(event.target.value).catch((problem) => setError(problem.message)); }} /></label><small>Finish and sync this shift before choosing another date. Future routes are read-only.</small><a href="/field/pilot/">Finish an earlier pilot shift</a></section>
          <section className={s.card}><h2>Your account</h2><button className={s.secondary} onClick={logout} disabled={!record || pending > 0}>Sign out</button></section>
          <section className={s.card}><h2>Install the field app</h2><p>On Android, use the browser menu and choose Install app. On iPhone, use Safari Share, then Add to Home Screen.</p><small>Offline access expires after 12 hours without session verification. Keep the app open while syncing.</small></section>
          <section className={s.card}><h2>Office connection</h2><p>Service reports and safety issues appear in the office after sync.</p><p>External service and payroll upload: Not built yet.</p></section>
          {day.shift.clockIn && !day.shift.clockOut ? <section className={s.card}><h2>Need to finish early?</h2><p>Record your actual finish time and leave a note for office follow-up. Incomplete work remains flagged.</p><button className={s.danger} disabled={disabled || !!active || !!day.shift.activeBreak} onClick={() => setModal({ type: "clock_out" })}>Early clock-out</button></section> : null}
        </>}
      </>}
    </main>
    {day && !locked && !safetyScreen && !(tab === "today" && selected && detailTab === "overview" && chosenTask?.status === "working") && !(tab === "closeout" && day.shift.status === "wrapping") ? <nav className={s.nav} aria-label="Technician navigation">{[["today", "Today"], ["route", "Map"], ["activity", "Activity"], ["more", "More"]].map(([id, label]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => openTab(id)}><FieldIcon name={id} size={21} /><span>{label}{id === "activity" && pending ? " (" + pending + ")" : ""}</span></button>)}</nav> : null}
    {preparing && day ? <PreparationSheet day={day} disabled={disabled} onClose={() => setPreparing(false)} onClock={(body) => dispatch("clock_in", body)} onCheck={(key, checked) => dispatch("check_item", { key, checked })} onLoad={(items) => dispatch("confirm_load", { items })} onStart={startRoute} /> : null}
    {modal && !modal.safety ? <ActionDialog modal={modal} customerTextsEnabled={record?.customerTextsEnabled === true} disabled={disabled || modal.type === "finish_day" && (safetyHold || missingProof > 0)} onClose={() => setModal(null)} onSubmit={async (body) => { if (await dispatch(modal.type, body)) { setModal(null); if (["finish_day", "clock_out"].includes(modal.type)) { openTab("closeout"); void synchronize(); } } }} /> : null}
    {pacing && active?.timed ? <PacingView task={active} stop={activeStop} timer={jobTimer(active.startedAt, null, active.estimatedMinutes, now)} onClose={() => setPacing(false)} /> : null}
  </div>;
}

function StopAccess({ stop, disabled, onSafety }) {
  const instructions = stop.instructions || "";
  const dogNames = instructions.match(/Dogs:\s*([^\.\n]+)/i)?.[1];
  const persistent = instructions.match(/Persistent:\s*([\s\S]*?)(?:Today:|$)/i)?.[1]?.trim() || instructions.replace(/Dogs:\s*[^\.\n]+\.?\s*/i, "").trim();
  const today = instructions.match(/Today:\s*([\s\S]*)/i)?.[1]?.trim();
  const unsafe = stop.safety === "unsafe" || stop.safety === "unknown" && /unsafe dog|unsecured dog/i.test(instructions);
  return <>
    <div className={`${s.access} ${unsafe ? s.unsafeAccess : ""}`}>
      <div className={s.accessHeading}><b><FieldIcon name="shield" size={17} /> Access and safety</b><span className={`${s.statusBadge} ${unsafe ? s.unsafeBadge : ""}`}>{unsafe ? "Unsafe dog" : stop.safety === "unknown" ? "Needs clearance" : "Check before entry"}</span></div>
      <div className={s.gateCode}><span>Gate code</span><strong className={!stop.gateCode ? s.noGateCode : undefined}>{stop.gateCode || "No code on file"}</strong></div>
      {stop.communityCode ? <p>Community code: <b>{stop.communityCode}</b></p> : null}
      <p><b>{stop.dogCount != null ? `${stop.dogCount} ${stop.dogCount === 1 ? "dog" : "dogs"}` : "Dog count not supplied"}</b>{dogNames ? ` · ${dogNames}` : ""}</p>
      {unsafe || stop.safety === "unknown" ? <p className={s.safetyWarning}>Do not enter. Office clearance is required before service.</p> : stop.safety === "confirmed" ? <p>Office clearance recorded. Check the property before entry.</p> : <p>Dogs must be secured before entering the yard.</p>}
      {!stop.tasks.every(taskDone) ? <button className={s.safetyButton} disabled={disabled} onClick={onSafety}>Report unsafe or unsecured dog</button> : null}
    </div>
    <div className={s.noteGrid}><section><h3>Persistent property notes</h3><p>{persistent || "No permanent access notes recorded."}</p></section><section className={s.todayNote}><h3>Today's visit notes</h3><p>{today || "No additional office instructions for this visit."}</p></section></div>
  </>;
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
function InventoryForm({ items, mode, disabled, onSubmit, id, hideSubmit = false }) {
  const [counts, setCounts] = useState({});
  return (
    <form
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
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
      <button disabled={disabled} hidden={hideSubmit}>
        {mode === "load" ? "Confirm load" : "Continue to clock-out"}
      </button>
    </form>
  );
}
function safetyBlocked(day) {
  return !!day && (day.issues.some((issue) => issue.reason === "Unsafe animal" && !issue.response) || day.stops.some((stop) => stop.safety === "unsafe" || stop.safety === "unknown" && /unsafe dog|unsecured dog/i.test(stop.instructions)));
}
function proofReady(stop, task) {
  if (task.proofKind === "none" || task.proofKind === "gate" && stop.hasGate === false) return true;
  const start = Date.parse(task.startedAt || stop.arrivedAt);
  return (task.proofKind === "gate" ? stop.tasks.flatMap((item) => item.photos) : task.photos).some((photo) => photo.purpose === task.proofKind && Date.parse(photo.at) >= start);
}
function propertyNotes(stop) {
  const text = stop.instructions || "";
  return { dogs: text.match(/Dogs:\s*([^\.\n]+)/i)?.[1] || "Names not recorded", persistent: text.match(/Persistent:\s*([\s\S]*?)(?:Today:|$)/i)?.[1]?.trim() || text.replace(/Dogs:\s*[^\.\n]+\.?\s*/i, "").trim() || "No permanent access notes recorded.", today: text.match(/Today:\s*([\s\S]*)/i)?.[1]?.trim() || "No additional office instructions for this visit." };
}
function MapLink({ stop, testMode = false }) {
  if (testMode) return <span className={s.mapDisabled}>Maps disabled for training</span>;
  return <a className={s.secondary} href={"https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(stop.latitude != null && stop.longitude != null ? stop.latitude + "," + stop.longitude : stop.address)} target="_blank" rel="noreferrer"><FieldIcon name="pin" size={17} /> Open in Maps</a>;
}
function PreparationSheet({ day, disabled, onClose, onClock, onCheck, onLoad, onStart }) {
  const ref = useRef(null), [problem, setProblem] = useState("");
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`${s.dialog} ${s.preparationDialog}`} onCancel={(event) => { event.preventDefault(); onClose(); }}><button className={s.textButton} onClick={onClose}>Close preparation</button><span className={s.eyebrow}>BEFORE YOU HEAD OUT</span><h2>Let's get ready.</h2><p className={s.tip}>Clock in, check your supplies and confirm the load.</p>{problem ? <p className={s.error}>{problem}</p> : null}
    {day.shift.status === "ready" ? <ClockForm disabled={disabled} onSubmit={async (body) => { if (!await onClock(body)) setProblem("Clock-in could not be saved. Review the odometer and try again."); }} /> : day.shift.status === "loading" ? <><div className={s.precheckList}>{PRECHECKS.map(([id, label]) => <label className={s.check} key={id}><input type="checkbox" checked={!!day.shift.prechecks[id]} disabled={disabled} onChange={(event) => onCheck(id, event.target.checked)} />{label}</label>)}</div><h3>Load check</h3><p className={s.tip}>{day.departureReady ? "Your assigned route is cleared for departure." : "The office must clear this route before departure."}</p><InventoryForm items={day.inventory} mode="load" disabled={disabled || !PRECHECKS.every(([id]) => day.shift.prechecks[id]) || !day.departureReady} onSubmit={async (items) => { if (!await onLoad(items)) setProblem("Load confirmation needs review. Check product counts and office clearance."); }} /></> : <section className={s.readyToGo}><span className={s.successGlyph}><FieldIcon name="check" size={27} /></span><h3>You're ready to go.</h3><p>Checklist complete. {day.stops.length} stops are assigned to you.</p><button className={s.bigPrimary} disabled={disabled} onClick={onStart}>Start route</button></section>}
  </dialog>;
}
function ServiceWorkflow({ task, stop, day, section, initialStage, onStageChange, now, disabled, draft, photos, onDraft, onAction, onPhoto, onPacing, onSkip, onSafety, onNext, onEta }) {
  const { testMode } = useContext(Environment);
  const [stage, setStage] = useState(taskDone(task) ? "done" : task.status === "working" ? ["proof", "complete"].includes(initialStage) ? initialStage : "service" : "overview"),
    [safe, setSafe] = useState(false), [dogsSecured, setDogsSecured] = useState(false), [secured, setSecured] = useState(false), [units, setUnits] = useState(false), [noIssues, setNoIssues] = useState(false), [notes, setNotes] = useState(draft ?? task.notes ?? ""), [savingPhoto, setSavingPhoto] = useState(false);
  const done = taskDone(task), proof = proofReady(stop, task), timer = jobTimer(task.startedAt, task.completedAt, task.estimatedMinutes, now), property = propertyNotes(stop);
  const completesStop = stop.tasks.filter((item) => !taskDone(item)).length === 1;
  const anotherStop = day.stops.some((item) => item.id !== stop.id && !item.tasks.every(taskDone));
  useEffect(() => { if (task.status === "working" && ["proof", "complete"].includes(initialStage)) setStage(initialStage); }, [initialStage, task.status]);
  function updateNote(value) { setNotes(value); onDraft(value); }
  function changeStage(value) { setStage(value); onStageChange?.(value); const query = new URLSearchParams(window.location.search); query.set("view", value === "proof" || value === "complete" ? value : "stop"); query.set("taskId", task.id); window.history.replaceState(null, "", "?" + query); window.scrollTo({ top: 0, behavior: "instant" }); }
  const delivery = task.deliveryItems.map((item) => ({ ...item, name: day.inventory.find((row) => row.productId === item.productId)?.name || "Scheduled dog food" }));
  async function capturePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSavingPhoto(true);
    try { await onPhoto(task, file, task.proofKind === "none" ? "observation" : task.proofKind); }
    finally { setSavingPhoto(false); }
  }
  const sticky = (label, onClick, blocked, capture = false) => {
    const arriveFirst = !stop.arrivedAt && task.status === "pending";
    const captureDisabled = disabled || savingPhoto || task.photos.length >= 8;
    return <div className={`${s.stopActions} ${task.status === "working" ? s.focusActions : ""}`} aria-label="Next stop action"><button className={s.skipAction} disabled={disabled || done} onClick={onSkip}>Skip</button>{capture ? <label className={`${s.completeAction} ${s.stickyCapture} ${captureDisabled ? s.captureDisabled : ""}`}><FieldIcon name="camera" size={19} />{savingPhoto ? "Saving photo..." : "Take photo"}<input type="file" accept="image/*" capture="environment" aria-label="Take or choose the required proof photo" disabled={captureDisabled} onChange={capturePhoto} /></label> : <button className={s.completeAction} disabled={disabled || done || !arriveFirst && blocked} onClick={arriveFirst ? () => onAction("arrive", { stopId: stop.id }) : onClick}>{arriveFirst ? "Arrive at stop" : label}</button>}</div>;
  };
  if (section === "notes") return <><section className={s.card}><span className={s.eyebrow}>PROPERTY INSTRUCTIONS</span><h2>Persistent notes</h2><p>{property.persistent}</p><h3>Today's office notes</h3><p>{property.today}</p></section><section className={s.card}><h2>Private service note</h2><p className={s.tip}>Saved for the office with this service.</p><label>Visit notes<textarea value={notes} maxLength={2000} disabled={disabled || done} onChange={(event) => updateNote(event.target.value)} /></label>{!done ? <VoiceNote value={notes} onChange={updateNote} /> : null}<button disabled={disabled || done} onClick={() => onAction("save_note", { taskId: task.id, notes })}>Save private note</button>{done ? <p className={s.tip}>This service is finished. The saved note is read-only.</p> : null}</section></>;
  if (section === "history") return <><section className={s.card}><span className={s.eyebrow}>THIS VISIT</span><h2>Service history</h2><div className={s.visitTimeline}>{[{ label: "Arrival recorded", at: stop.arrivedAt }, { label: "Service started", at: task.startedAt }, ...task.photos.map((photo) => ({ label: pretty(photo.purpose) + " photo saved", at: photo.at })), { label: task.status === "skipped" ? "Service skipped" : "Service completed", at: task.completedAt }].filter((entry) => entry.at).map((entry, index) => <div key={index}><i /><span>{entry.label}</span><b>{time(entry.at)}</b></div>)}</div>{!stop.arrivedAt && !task.startedAt && !task.photos.length && !task.completedAt ? <p>This visit has not started.</p> : null}{task.notes || task.reason ? <p>{task.notes || task.reason}</p> : null}<ProofPhotos photos={task.photos} local={photos} /></section><section className={s.card}><h3>Earlier property visits</h3><p className={s.tip}>Not built yet. This view shows the current assigned visit.</p></section></>;
  if (done) return <section className={`${s.card} ${s.serviceResult}`}><span className={s.successGlyph}><FieldIcon name="check" size={27} /></span><span className={s.eyebrow}>{task.status === "completed" ? "SERVICE SAVED" : "EXCEPTION SAVED"}</span><h2>{task.status === "completed" ? stop.tasks.every(taskDone) ? "Stop complete." : "Service complete." : "Office follow-up requested."}</h2><p>{serviceName(task)} · {time(task.completedAt)}</p>{task.notes || task.reason ? <p>{task.notes || task.reason}</p> : null}<div className={s.resultFacts}><span><FieldIcon name="shield" size={17} />{task.status === "completed" ? "Required checks recorded" : "Reason recorded"}</span><span><FieldIcon name="camera" size={17} />{task.photos.length} photos saved</span></div><ProofPhotos photos={task.photos} local={photos} /><button className={s.bigPrimary} onClick={onNext}>{stop.tasks.every(taskDone) ? anotherStop ? "Next stop" : "Review route closeout" : "Next service at this stop"}</button></section>;
  if (stage === "proof" && task.status === "working") return <>
    <div className={s.stepHeading}><span>STEP 2 OF 3</span><h2>{task.proofKind === "gate" ? "Gate photo" : task.proofKind === "delivery" ? "Delivery photo" : "Service photo"}</h2><p>{task.proofKind === "gate" ? "Show the closed gate and latched lock before leaving." : task.proofKind === "delivery" ? "Show every bag placed in the requested delivery location." : "Show the finished work for this service."}</p></div>
    <section className={`${s.card} ${s.proofCard}`}><span className={s.requiredTag}>REQUIRED PHOTO</span><div className={task.photos.length ? s.proofGallery : s.photoCapture}><ProofPhotos photos={task.photos} local={photos} />{!task.photos.length ? <><span className={s.cameraGlyph}><FieldIcon name="camera" size={40} /></span><h3>{task.proofKind === "gate" ? "Capture the latched gate" : "Capture completed work"}</h3><p>A clear photo protects the customer, the technician and the visit record.</p></> : null}</div>{task.photos.length ? <label className={s.captureButton}><FieldIcon name="camera" size={19} />{savingPhoto ? "Saving photo..." : "Add another photo"}<input type="file" accept="image/*" capture="environment" aria-label="Add another proof photo" disabled={disabled || savingPhoto || task.photos.length >= 8} onChange={capturePhoto} /></label> : null}<p className={`${s.proofStatus} ${proof ? s.proofReady : ""}`}><FieldIcon name={proof ? "check" : "shield"} size={17} />{proof ? "Required proof is saved on this device." : "Required proof must be saved before completion."}</p>{testMode ? <button className={s.secondary} disabled={disabled || savingPhoto} onClick={async () => { const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360; const context = canvas.getContext("2d"); context.fillStyle = "#34383f"; context.fillRect(0, 0, 640, 360); context.fillStyle = "white"; context.font = "28px Arial"; context.fillText("TRAINING PHOTO", 35, 70); context.font = "20px Arial"; context.fillText("No customer evidence", 35, 130); const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .75)); if (blob) await onPhoto(task, new File([blob], "training-proof.jpg", { type: "image/jpeg" }), task.proofKind); }}>Use training proof</button> : null}</section><button className={s.textButton} onClick={() => changeStage("service")}>Back to service</button>{sticky("Use photo", () => changeStage("complete"), !proof || savingPhoto, !proof)}
  </>;
  if (stage === "complete" && task.status === "working") return <>
    <div className={s.stepHeading}><span>STEP 3 OF 3</span><h2>{completesStop ? "Complete stop" : task.serviceId === "food" ? "Complete delivery" : "Complete service"}</h2><p>Review the details before moving to your next stop.</p></div><section className={s.card}><div className={s.completionService}><FieldIcon name={task.serviceId === "food" ? "bag" : "shield"} size={24} /><div><h3>{serviceName(task)}</h3><p>{taskUnits(task)} · {clockText(timer.elapsedSeconds)}</p>{task.serviceId === "food" ? <>{delivery.map((item) => <p key={item.productId} style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5 }}><strong>{item.quantity} x {item.name}</strong></p>)}{task.placementNote ? <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5 }}>Placement: {task.placementNote}</p> : null}</> : null}</div></div><label className={s.toggleCheck}><span><b>{task.serviceId === "food" ? "Delivery placed as instructed" : stop.hasGate !== false ? "Gate closed and latched" : "Property secured"}</b><small>{task.serviceId === "food" ? "All bags are in the assigned location." : "Leave the property secure before departure."}</small></span><input type="checkbox" checked={secured} onChange={(event) => setSecured(event.target.checked)} /></label><label className={s.toggleCheck}><span><b>All scheduled work is complete</b><small>{taskUnits(task)} accounted for.</small></span><input type="checkbox" checked={units} onChange={(event) => setUnits(event.target.checked)} /></label><label className={s.toggleCheck}><span><b>No unresolved safety issues</b><small>Use the safety report if access is unsafe.</small></span><input type="checkbox" checked={noIssues} onChange={(event) => setNoIssues(event.target.checked)} /></label><button className={s.safetyButton} disabled={disabled} onClick={onSafety}>Report a safety issue</button><label>Visit note <span className={s.optionalLabel}>Optional</span><textarea maxLength={2000} value={notes} onChange={(event) => updateNote(event.target.value)} placeholder="Add a note for the office" /></label><div className={s.proofInline}><FieldIcon name={proof ? "check" : "camera"} size={18} /><span>{proof ? task.photos.length + " photos saved" : "Required photo missing"}</span><button className={s.textButton} onClick={() => changeStage("proof")}>Review photos</button></div><ProofPhotos photos={task.photos} local={photos} /></section>{sticky(completesStop ? "Complete stop" : "Complete service", async () => { if (await onAction("complete_task", { taskId: task.id, secured: true, units: task.quantity, notes })) changeStage("done"); }, !secured || !units || !noIssues || !proof)}
  </>;
  if (task.status === "working") return <><div className={s.stepHeading}><span>STEP 1 OF 3</span><h2>Service in progress</h2><p>{serviceName(task)} · {taskUnits(task)}</p></div><section className={s.card}><button className={`${s.timer} ${timer.over ? s.over : ""}`} onClick={onPacing}><FieldIcon name="clock" size={23} /><b>{clockText(timer.elapsedSeconds)}</b><span>{timer.over ? "+" + clockText(timer.overtimeSeconds) + " over plan" : clockText(Math.max(0, timer.allottedSeconds - timer.elapsedSeconds)) + " of planned time left"}</span></button>{task.instructions ? <p>{task.instructions}</p> : null}{task.placementNote ? <p><b>Delivery location:</b> {task.placementNote}</p> : null}{delivery.length ? <div className={s.deliveryList}>{delivery.map((item) => <div key={item.productId}><FieldIcon name="bag" size={22} /><span>{item.name}</span><b>{item.quantity} bag{item.quantity === 1 ? "" : "s"}</b></div>)}</div> : null}<p className={s.tip}>{task.proofKind === "gate" ? "A latched gate photo is required after the work is finished." : task.proofKind === "delivery" ? "A delivery photo is required before completing this stop." : task.proofKind === "service" ? "A service photo is required before completion." : "Confirm the assigned units and property security before completion."}</p><button className={s.safetyButton} disabled={disabled} onClick={onSafety}>Report unsafe access</button></section>{sticky("Finish work", () => changeStage(task.proofKind === "none" || task.proofKind === "gate" && stop.hasGate === false ? "complete" : "proof"), false)}</>;
  return <>
    {disabled && day.shift.status !== "on_route" ? <p className={s.proofRequirement}>Start the route and complete departure checks before working this stop.</p> : null}
    <StopAccess stop={stop} disabled={disabled} onSafety={onSafety} />
    <div className={s.serviceEstimate}><FieldIcon name="clock" size={18} /><span>{serviceName(task)}</span><b>{task.estimatedMinutes} min planned</b></div>
    <div className={s.mapActions}><MapLink stop={stop} testMode={testMode} /><button className={s.secondary} disabled={disabled || !!activeService(day)} onClick={onEta}>Arrival estimate</button></div>

    {task.instructions ? <section className={s.card}><h3>Service instructions</h3><p>{task.instructions}</p></section> : null}
    {delivery.length ? <section className={s.card}><span className={s.eyebrow}>DOG FOOD DELIVERY</span><h2>What to deliver</h2><div className={s.deliveryList}>{delivery.map((item) => <div key={item.productId}><FieldIcon name="bag" size={22} /><span>{item.name}</span><b>{item.quantity} bag{item.quantity === 1 ? "" : "s"}</b></div>)}</div><p>{task.placementNote || "Place the bags in the assigned delivery location."}</p></section> : null}
    <section className={s.card}><span className={s.eyebrow}>BEFORE YOU START</span><h2>Safety checklist</h2><label className={s.check}><input type="checkbox" checked={dogsSecured} onChange={(event) => setDogsSecured(event.target.checked)} disabled={disabled} />{task.entryRequired ? "Dogs are secured away from the service area" : "The delivery area is clear of unsecured dogs"}</label><label className={s.check}><input type="checkbox" checked={safe} onChange={(event) => setSafe(event.target.checked)} disabled={disabled} />I checked access and it is safe to work</label>{["unknown", "unsafe"].includes(stop.safety) && task.entryRequired ? <p className={s.error}>Do not enter. This stop requires office clearance.</p> : null}</section>
    {sticky("Start service", async () => { if (await onAction("start_task", { taskId: task.id, safe: true })) changeStage("service"); }, !stop.arrivedAt || !safe || !dogsSecured || task.entryRequired && ["unknown", "unsafe"].includes(stop.safety))}
  </>;
}
function SafetyReport({ stop, task, disabled, onClose, onSubmit }) {
  const [unsecured, setUnsecured] = useState(true), [skip, setSkip] = useState(true), [contact, setContact] = useState(true), [notes, setNotes] = useState("");
  return <><button className={s.backLink} onClick={onClose}><FieldIcon name="back" size={17} /> Back to stop</button><div className={s.safetyHero}><span className={s.safetyGlyph}><FieldIcon name="alert" size={32} /></span><span className={s.eyebrow}>SAFETY FIRST</span><h1>Dog unsecured.</h1><p>Stay outside the service area. Do not enter until the office records clearance.</p></div><section className={s.card}><h2>{stop.name}</h2><p>{stop.address}</p><div className={s.workTags}><span>{serviceName(task)}</span><span>{stop.dogCount} {stop.dogCount === 1 ? "dog" : "dogs"}</span></div></section><form className={s.safetyForm} onSubmit={(event) => { event.preventDefault(); onSubmit({ notes }); }}><section className={s.card}><h2>Report unsafe access</h2><p className={s.tip}>This report marks unsafe access, skips the affected service and creates an office review item.</p><label className={s.toggleCheck}><span><b>Mark access unsafe</b><small>A dog is unsecured or access is unsafe.</small></span><input type="checkbox" checked={unsecured} required onChange={(event) => setUnsecured(event.target.checked)} /></label><label className={s.toggleCheck}><span><b>Skip this service</b><small>The visit needs office follow-up.</small></span><input type="checkbox" checked={skip} required onChange={(event) => setSkip(event.target.checked)} /></label><label className={s.toggleCheck}><span><b>Contact the office</b><small>Add this safety report to the office queue.</small></span><input type="checkbox" checked={contact} required onChange={(event) => setContact(event.target.checked)} /></label><label>What happened?<textarea value={notes} required maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="Describe the dog, access issue and where you are waiting" /></label><p className={s.safetyInstruction}><FieldIcon name="shield" size={18} />Keep a safe distance and wait for office guidance.</p></section><div className={s.safetySubmit}><button className={s.bigPrimary} disabled={disabled || !unsecured || !skip || !contact || !notes.trim()}>Submit &amp; alert office</button><small>The office receives the report when your device syncs.</small></div></form></>;
}
function CloseoutReview({ day, summary, pending, proofCount, missingProof, safetyHold, online, disabled, onStart, onCheck, onFinish, onSync, onViewStop, onBack }) {
  const finished = day.shift.status === "finished", wrapping = day.shift.status === "wrapping", unaccounted = summary.services - summary.accounted;
  const blocked = disabled || unaccounted > 0 || missingProof > 0 || safetyHold;
  const wrapChecksDone = WRAPCHECKS.every(([id]) => day.shift.wrapchecks[id]);
  return <>
    {onBack ? <button className={s.backLink} onClick={onBack}><FieldIcon name="back" size={17} /> Back to route</button> : null}
    <div className={s.pageHeading}><span className={s.eyebrow}>END OF ROUTE</span><h1>{finished ? "Route saved." : "Finish your route"}</h1><p>{finished ? "Your service records and actual work time have been recorded." : "Review proof and safety, then finish your wrap checklist."}</p></div>
    <div className={s.closeoutStats}><div><FieldIcon name="check" /><b>{summary.stopsFinished}/{summary.stops}</b><span>Stops finished</span></div><div><FieldIcon name="camera" /><b>{proofCount}</b><span>Photos saved</span></div><div><FieldIcon name="alert" /><b>{summary.unresolvedIssues}</b><span>Open issues</span></div></div>
    {unaccounted || missingProof || safetyHold ? <section className={`${s.card} ${s.attention}`}><h2>Closeout needs attention</h2>{unaccounted ? <p>{unaccounted} scheduled service{unaccounted === 1 ? "" : "s"} still need completion or a skip reason.</p> : null}{missingProof ? <p>{missingProof} completed services are missing required photos.</p> : null}{safetyHold ? <p>Unresolved safety items require office clearance before normal closeout.</p> : null}</section> : null}
    {wrapping ? <section className={s.card}><span className={s.eyebrow}>FINAL CHECKS</span><h2>Before you clock out</h2>{WRAPCHECKS.map(([id, label]) => <label className={s.check} key={id}><input type="checkbox" checked={!!day.shift.wrapchecks[id]} disabled={disabled} onChange={(event) => onCheck(id, event.target.checked)} />{label}</label>)}<InventoryForm id="field-wrap-inventory" hideSubmit items={day.inventory} mode="returns" disabled={blocked || !wrapChecksDone} onSubmit={onFinish} /></section> : null}
    <details className={`${s.card} ${s.summaryDetails}`} open={!wrapping}><summary>Route summary<span>{hours(summary.paidSeconds)} recorded</span></summary><div className={s.summaryLine}><span>Services completed</span><b>{summary.completed}</b></div><div className={s.summaryLine}><span>Services skipped</span><b>{summary.skipped}</b></div><div className={s.summaryLine}><span>Photo checks</span><b>{missingProof ? missingProof + " missing" : "Required proof present"}</b></div><div className={s.summaryLine}><span>Device sync</span><b>{pending ? pending + " queued" : "Up to date"}</b></div></details>
    <details className={s.closeoutStops} open={unaccounted > 0}><summary>Today's stops<span>{summary.stopsFinished} of {day.stops.length} finished</span></summary>{day.stops.map((stop, index) => <button key={stop.id} onClick={() => onViewStop(stop)}><span className={s.stopNumber}>{stop.tasks.every(taskDone) ? <FieldIcon name="check" size={16} /> : index + 1}</span><div><b>{stop.name}</b><small>{stop.tasks.filter((task) => task.status === "completed").length} complete · {stop.tasks.reduce((n, task) => n + task.photos.length, 0)} photos</small></div><span className={s.statusBadge}>{stop.tasks.every(taskDone) ? "Accounted" : "Needs work"}</span></button>)}</details>
    {wrapping ? <div className={`${s.closeoutAction} ${s.focusActions}`}><button className={s.bigPrimary} form="field-wrap-inventory" type="submit" disabled={blocked || !wrapChecksDone}>Continue to clock-out</button><small>{wrapChecksDone ? "Review returned stock, then enter your final odometer." : "Complete the final checks above before clock-out."}</small></div> : finished ? <section className={`${s.card} ${s.closeoutComplete}`}><span className={s.successGlyph}><FieldIcon name="check" size={24} /></span><h2>{pending ? "Work saved on this device" : "Your work is synced"}</h2><p>Clocked out at {time(day.shift.clockOut)}.</p>{pending ? <button disabled={!online} onClick={onSync}>Sync saved work</button> : null}</section> : <div className={s.closeoutAction}><button className={s.bigPrimary} disabled={blocked || !online || day.shift.status !== "on_route"} onClick={onStart}>Sync &amp; close route</button><small>{!online ? "Reconnect to sync and close. Work is saved on this device." : blocked ? "Resolve the items above before closing this route." : "Continue to the wrap-up checklist and final odometer."}</small></div>}
  </>;
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
    [reason, setReason] = useState(modal.safety ? "Unsafe animal" : "Locked gate"),
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
        <h2>{modal.safety ? "Unsafe or unsecured dog" : modal.type === "skip_task" ? "Skip service" : pretty(modal.type)}</h2>
        {modal.safety ? <p className={s.error}>Stay clear of the property. This creates a safety report for the office and blocks entry until the office records clearance.</p> : null}
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
            <select value={reason} disabled={modal.safety} onChange={(e) => setReason(e.target.value)}>
              {(modal.safety ? ["Unsafe animal"] : [
                "Locked gate",
                "Weather",
                "Customer request",
                "Equipment",
                "Other",
              ]).map((r) => (
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
          {modal.safety ? "I am clear of the property and need office follow-up" : "I reviewed this action"}
          {needsMileage ? " and verified the odometer" : ""}.
        </label>
        <button disabled={disabled}>{modal.safety ? "Save safety report" : `Save ${pretty(modal.type)}`}</button>
      </form>
    </dialog>
  );
}
