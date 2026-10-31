'use client';

import { useEffect, useRef, useState } from 'react';
import { clockText } from '@/lib/field-timer.mjs';
import s from './mobile.module.css';

export default function PacingView({ timer, task, stop, onClose }) {
  const dialog = useRef(null);
  const [awake, setAwake] = useState(false);
  const [wakeStatus, setWakeStatus] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!awake) { setWakeStatus(''); return; }
    let disposed = false, sentinel = null, requesting = false;
    async function acquire() {
      if (disposed || requesting || sentinel || document.visibilityState !== 'visible') return;
      if (!navigator.wakeLock) { setWakeStatus('This browser cannot keep the screen awake. Your timer still saves normally.'); return; }
      requesting = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (disposed) { await lock.release(); return; }
        sentinel = lock;
        setWakeStatus('Screen awake while this view is open.');
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
          if (!disposed) setWakeStatus('Screen awake paused by your phone. Reopen this view or toggle the setting to retry.');
        });
      } catch { if (!disposed) setWakeStatus('Your phone declined screen awake. Check battery settings or try again. The timer keeps its place.'); }
      finally { requesting = false; }
    }
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => { disposed = true; document.removeEventListener('visibilitychange', acquire); void sentinel?.release().catch(() => {}); };
  }, [awake]);
  return <dialog ref={dialog} className={`${s.pacingView} ${timer.over ? s.pacingOver : ''}`} aria-labelledby="pacing-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={s.pacingTop}><span>ROUTE PARTNER · PACING</span><button aria-label="Close pacing view" onClick={onClose}>×</button></div>
    <div className={s.pacingMain}>
      <p>{stop.name}</p><h2 id="pacing-title">{task.title}</h2>
      <span className={s.pacingStatus}>{timer.over ? 'Over allotted time' : 'Service in progress'}</span>
      <strong className={s.pacingDigits}>{clockText(timer.elapsedSeconds)}</strong>
      <p className={s.pacingRemaining}>{timer.over ? `+${clockText(timer.overtimeSeconds)} over` : `${clockText(Math.max(0, timer.allottedSeconds - timer.elapsedSeconds))} remaining`}</p>
      <div className={s.timerTrack}><span style={{ width: `${timer.progress}%` }}/></div>
      <p>{task.estimatedMinutes} minutes allotted</p>
    </div>
    <div className={s.pacingFooter}>
      <label className={s.check}><input type="checkbox" checked={awake} onChange={event => setAwake(event.target.checked)}/><span>Keep screen awake</span></label>
      {wakeStatus ? <p role="status">{wakeStatus}</p> : null}
      <p>Locking your phone keeps time accurate. A lock-screen display requires the future native app.</p>
      <button className={s.primary} onClick={onClose}>Back to service</button>
    </div>
  </dialog>;
}
