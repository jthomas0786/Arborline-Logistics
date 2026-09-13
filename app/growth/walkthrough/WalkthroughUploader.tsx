"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "connect-walkthrough";
const OBJECT_PATH = "arborline-connect-walkthrough.mp4";
const MAX_BYTES = 50 * 1024 * 1024;

export function WalkthroughUploader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const input = event.currentTarget.elements.namedItem("video");
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      setMessage("Choose the final MP4 first.");
      return;
    }

    const file = input.files[0];
    if (file.type !== "video/mp4" && !file.name.toLowerCase().endsWith(".mp4")) {
      setMessage("The walkthrough must be an MP4 file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage("The walkthrough must be 50 MB or smaller.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { data: signed, error: signedError } = await supabase.functions.invoke("connect-walkthrough-upload-url", {
        body: { size: file.size, contentType: file.type || "video/mp4" }
      });
      if (signedError) throw signedError;
      const token = typeof signed?.token === "string" ? signed.token : null;
      if (!token) throw new Error("Signed upload token was not returned");

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(OBJECT_PATH, token, file, { contentType: "video/mp4" });
      if (uploadError) throw uploadError;

      setMessage("Walkthrough uploaded successfully.");
      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      console.error("Walkthrough upload failed", error);
      setMessage("Upload failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={onSubmit} style={{display:"grid",gap:12}}>
    <input name="video" type="file" accept="video/mp4,.mp4" disabled={busy} />
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload final walkthrough"}</button>
      <small className="muted">MP4 only · 50 MB max · replaces the current walkthrough</small>
    </div>
    {message ? <div className="notice"><strong>{message}</strong></div> : null}
  </form>;
}
