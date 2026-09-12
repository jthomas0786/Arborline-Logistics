"use client";

import { useEffect, useState } from "react";

type Capability = {
  kind: "CARRIER_OFFER" | "CARRIER_DISPATCH" | "DRIVER_LOAD";
  token: string;
};

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function PushOptIn({ publicKey, capability, compact = false }: { publicKey: string; capability?: Capability; compact?: boolean }) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function registration() {
    return navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }

  async function save(subscription: PushSubscription) {
    const response = await fetch(capability ? "/api/public/push/subscriptions" : "/api/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        ...(capability ? capability : {})
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Unable to save notification subscription.");
  }

  useEffect(() => {
    if (!publicKey || typeof window === "undefined") return;
    const available = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(available);
    if (!available) return;
    void (async () => {
      try {
        const serviceWorker = await registration();
        const existing = await serviceWorker.pushManager.getSubscription();
        if (existing && Notification.permission === "granted") {
          await save(existing);
          setSubscribed(true);
        }
      } catch {
        // Opt-in remains available; errors are surfaced if the user taps the control.
      }
    })();
    // Capability/public key are stable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, capability?.kind, capability?.token]);

  if (!publicKey || !supported) return null;

  async function toggle() {
    setBusy(true);
    setMessage("");
    try {
      const serviceWorker = await registration();
      const existing = await serviceWorker.pushManager.getSubscription();
      if (subscribed && existing) {
        const response = await fetch(capability ? "/api/public/push/subscriptions" : "/api/push/subscriptions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint, ...(capability ? capability : {}) })
        });
        if (!response.ok) throw new Error("Unable to disable notifications.");
        await existing.unsubscribe();
        setSubscribed(false);
        setMessage("Notifications disabled on this device.");
        return;
      }

      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notification permission was not granted.");
        return;
      }
      const subscription = existing ?? await serviceWorker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey)
      });
      await save(subscription);
      setSubscribed(true);
      setMessage("Notifications enabled on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update notifications.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={`pushOptIn${compact ? " compact" : ""}`}>
    <button type="button" className="pushButton" disabled={busy} onClick={toggle}>
      {busy ? "Updating…" : subscribed ? "Notifications on" : "Enable notifications"}
    </button>
    {!compact && <small>{subscribed ? "Arborline can send load alerts to this device." : "Get Arborline load alerts without SMS fees."}</small>}
    {message && <small className="pushMessage">{message}</small>}
  </div>;
}
