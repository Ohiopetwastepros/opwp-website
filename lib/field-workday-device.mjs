import { applyWorkdayEvent } from "./field-workday-model.mjs";
const DB = "opwp-workdays-v1";
export function assertDeviceSession(key, session) {
  if (
    !session?.authenticated ||
    `${session.member?.organizationId}:${session.member?.id}` !== key
  ) {
    const error = new Error(
      "The signed-in account changed. Reauthenticate; pending device work is retained for its original account.",
    );
    error.status = 401;
    throw error;
  }
}
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("accounts");
      request.result.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Device storage is unavailable. Work was not saved."));
  });
}
export async function deviceAccount() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readonly"),
      r = tx.objectStore("meta").get("active");
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export async function readWorkdayDevice(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("accounts", "readonly"),
      r = tx.objectStore("accounts").get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export async function updateWorkdayDevice(key, change) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["accounts", "meta"], "readwrite"),
      store = tx.objectStore("accounts"),
      r = store.get(key);
    let next, problem;
    r.onsuccess = () => {
      try {
        next = change(r.result || null);
        if (next) {
          next.key = key;
          store.put(next, key);
          tx.objectStore("meta").put(key, "active");
        } else {
          store.delete(key);
          tx.objectStore("meta").delete("active");
        }
      } catch (error) {
        problem = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(next);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        problem ||
          new Error(
            "Device storage is full or unavailable. This action was not saved.",
          ),
      );
    };
  });
}
export async function commitDeviceEvent(
  key,
  type,
  body,
  { photo = null, changes = [], now = Date.now() } = {},
) {
  return updateWorkdayDevice(key, (saved) => {
    if (
      !saved?.day ||
      !Number.isFinite(Date.parse(saved.offlineUntil)) ||
      Date.parse(saved.offlineUntil) <= now
    )
      throw new Error(
        "Sign in online again to unlock this workday. Saved work is retained.",
      );
    const event = {
      id: crypto.randomUUID(),
      shiftId: saved.day.id,
      expectedRevision: saved.day.revision,
      type,
      body,
      recordedAt: new Date(now).toISOString(),
    };
    const day = applyWorkdayEvent(saved.day, event, {
      now,
      officeChanges: changes,
    });
    return {
      ...saved,
      day,
      pending: [...saved.pending, event],
      photos: photo ? { ...saved.photos, [body.photoId]: photo } : saved.photos,
    };
  });
}
export async function syncDeviceWorkday(key, api) {
  let saved = await readWorkdayDevice(key);
  while (saved?.pending.length) {
    const event = saved.pending[0];
    if (event.type === "add_photo") {
      const blob = saved.photos[event.body.photoId];
      if (!blob)
        throw new Error(
          "Saved photo is missing. Export the workday and contact the office.",
        );
      await api.upload(event, blob);
    }
    const receipt = await api.event(event);
    if (!receipt.accepted)
      throw new Error("The server did not acknowledge this action.");
    saved = await updateWorkdayDevice(key, (current) => {
      if (current.day.id !== event.shiftId)
        throw new Error("Account or workday changed during sync.");
      return {
        ...current,
        acknowledged: Math.max(current.acknowledged, receipt.revision),
        pending: current.pending.filter((e) => e.id !== event.id),
      };
    });
  }
  return saved;
}
export function adoptServerWorkday(saved, result) {
  if (saved?.pending?.length) {
    if (result.day?.id !== saved.day.id)
      throw new Error(
        "A different workday is assigned. Pending work is retained for office reconciliation.",
      );
    return {
      ...saved,
      offlineUntil: result.offlineUntil,
      changes: result.changes,
      messages: result.messages,
      sourceChanged: result.sourceChanged,
      customerTextsEnabled: result.customerTextsEnabled === true,
    };
  }
  const sameWorkday = Boolean(saved?.day && result.day && saved.day.id === result.day.id);
  return {
    day: result.day,
    pending: [],
    photos: sameWorkday ? saved.photos || {} : {},
    drafts: sameWorkday ? saved.drafts || {} : {},
    acknowledged: result.day?.revision || 0,
    offlineUntil: result.offlineUntil,
    member: result.member,
    changes: result.changes,
    messages: result.messages,
    sourceChanged: result.sourceChanged,
    customerTextsEnabled: result.customerTextsEnabled === true,
  };
}
