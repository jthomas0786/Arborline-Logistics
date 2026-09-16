"use client";

import { useEffect } from "react";

export function SampleViewTracker({ token }: { token: string }) {
  useEffect(() => {
    if (!token) return;

    let fired = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const record = () => {
      if (fired || document.visibilityState !== "visible") return;
      fired = true;
      void fetch("/api/public/connect-sample-view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
        keepalive: true
      }).finally(() => {
        if (window.location.pathname === "/sample") {
          window.history.replaceState(null, "", "/sample");
        }
      });
    };

    const schedule = () => {
      if (fired || timer || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        timer = null;
        record();
      }, 1500);
    };

    const onVisibilityChange = () => schedule();
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [token]);

  return null;
}
