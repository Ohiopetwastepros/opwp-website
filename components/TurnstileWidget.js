"use client";

import { useEffect, useId, useRef, useState } from "react";

const SCRIPT_ID = "opwp-turnstile-script";

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID);
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => resolve(window.turnstile), { once: true });
    script.addEventListener("error", () => reject(new Error("verification unavailable")), { once: true });
  });
}

export default function TurnstileWidget({ onToken, resetKey = 0, action = "turnstile-spin-v1" }) {
  const container = useRef(null);
  const widgetId = useRef(null);
  const id = useId();
  const [error, setError] = useState("");
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!sitekey || !container.current) return undefined;
    let cancelled = false;
    loadTurnstile().then((turnstile) => {
      if (cancelled || !turnstile || widgetId.current !== null) return;
      widgetId.current = turnstile.render(container.current, {
        sitekey,
        action,
        callback: (token) => { setError(""); onToken(token); },
        "expired-callback": () => onToken(""),
        "error-callback": () => { onToken(""); setError("Verification could not load. Please retry."); },
      });
    }).catch(() => setError("Verification could not load. Please retry."));
    return () => { cancelled = true; };
  }, [action, onToken, sitekey]);

  useEffect(() => {
    if (widgetId.current !== null && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onToken("");
    }
  }, [onToken, resetKey]);

  if (!sitekey) return <p role="alert" style={{ color: "#8a3b36", fontSize: 12 }}>Form verification is not configured. Please call or text 419-262-2371.</p>;
  return <div><div id={"turnstile-" + id.replaceAll(":", "")} ref={container} data-action="turnstile-spin-v1" />{error ? <p role="alert" style={{ color: "#8a3b36", fontSize: 12 }}>{error}</p> : null}</div>;
}
