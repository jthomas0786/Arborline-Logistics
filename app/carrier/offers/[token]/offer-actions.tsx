"use client";

import { useState } from "react";

export function OfferActions({ token, currentRate }: { token: string; currentRate: number }) {
  const [counter, setCounter] = useState(String(Math.round(currentRate + 100)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function respond(responseType: "ACCEPT" | "DECLINE" | "COUNTER") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/public/offers/${token}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response: responseType, ...(responseType === "COUNTER" ? { counterRate: Number(counter) } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to submit response");
      const action = data.result?.action ?? "RECEIVED";
      if (action === "AUTO_BOOK") setMessage("Booked. Arborline accepted your truck for this load.");
      else if (action === "DECLINED") setMessage("Declined. No further action is needed.");
      else if (action === "MANUAL_REVIEW") setMessage("Counter received. It is outside an automatic rule and has been routed for review.");
      else if (action === "BLOCK") setMessage("The booking could not proceed because a carrier verification check requires attention.");
      else if (action === "ALREADY_BOOKED") setMessage("This load has already been covered.");
      else if (action === "EXPIRED") setMessage("This offer has expired.");
      else setMessage(`Response received: ${action}.`);
      setDone(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to submit response"); }
    finally { setBusy(false); }
  }

  return <div className="offerActions"><button disabled={busy || done} onClick={() => respond("ACCEPT")}>Accept ${currentRate.toLocaleString()}</button><div className="counterRow"><span>$</span><input aria-label="Counter rate" type="number" min="1" value={counter} onChange={(event) => setCounter(event.target.value)} /><button className="secondary" disabled={busy || done} onClick={() => respond("COUNTER")}>Counter</button></div><button className="declineButton" disabled={busy || done} onClick={() => respond("DECLINE")}>Decline load</button>{message && <div className="offerMessage">{message}</div>}</div>;
}
