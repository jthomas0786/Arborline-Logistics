"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const MAX_FILES = 6;
const MAX_FILE_BYTES = 4_000_000;
const MAX_PACKET_BYTES = 12_000_000;

async function prepareMobileImage(file: File) {
  if (!file.type.startsWith("image/") || file.size <= 3_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 2200 / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob) return file;
    const stem = file.name.replace(/\.[^.]+$/, "") || "pod-photo";
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

export function PodUpload({ token, initialReceived = false, initialInvoiceNumber = null }: { token: string; initialReceived?: boolean; initialInvoiceNumber?: string | null }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [received, setReceived] = useState(initialReceived);
  const [invoiceNumber, setInvoiceNumber] = useState(initialInvoiceNumber);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [billingPending, setBillingPending] = useState(false);
  const [message, setMessage] = useState("");

  const previews = useMemo(
    () => files.map((file) => file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [files]
  );

  useEffect(() => () => {
    previews.forEach((preview) => { if (preview) URL.revokeObjectURL(preview); });
  }, [previews]);

  async function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setPreparing(true);
    setMessage("");
    try {
      const incoming = Array.from(fileList);
      const pdfs = incoming.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
      if (pdfs.length > 0) {
        if (incoming.length !== 1) return setMessage("Choose either one PDF or a set of POD photos, not both.");
        if (pdfs[0].size > MAX_FILE_BYTES) return setMessage("The PDF is larger than 4 MB.");
        setFiles([pdfs[0]]);
        return;
      }
      if (files.some((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
        return setMessage("Remove the PDF before adding POD photos.");
      }

      const normalized: File[] = [];
      for (const file of incoming) normalized.push(await prepareMobileImage(file));
      const combined = [...files, ...normalized];
      if (combined.length > MAX_FILES) return setMessage(`A POD packet can contain up to ${MAX_FILES} photos.`);
      const oversize = combined.find((file) => file.size > MAX_FILE_BYTES);
      if (oversize) return setMessage(`${oversize.name} is still larger than 4 MB after mobile optimization.`);
      const totalBytes = combined.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_PACKET_BYTES) return setMessage("The selected POD photos exceed the 12 MB packet limit.");
      setFiles(combined);
    } finally {
      setPreparing(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
    }
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
    setMessage("");
  }

  async function upload() {
    if (files.length === 0) return setMessage("Take a photo or choose the signed POD first.");
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      files.forEach((file) => body.append("pod", file));
      const response = await fetch(`/api/public/tracking/${token}/pod`, { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to upload POD");
      setReceived(true);
      setBillingPending(Boolean(data.billingPending));
      setInvoiceNumber(data.invoiceNumber ?? null);
      if (data.alreadyReceived) setMessage("POD was already received by Arborline.");
      else if (data.billingPending) setMessage(data.message ?? "POD received. Billing setup is being resolved by Arborline.");
      else setMessage(files.length > 1 ? `${files.length} POD pages validated. Billing records created.` : "POD validated. Billing records created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to upload POD");
    } finally {
      setBusy(false);
    }
  }

  if (received) return <div className="offerClosed"><strong>POD received</strong><p>{billingPending ? "The signed POD is on file. Arborline is resolving billing setup." : invoiceNumber ? `The signed POD passed validation and billing started. Reference: ${invoiceNumber}.` : "The signed POD is on file and billing is processing."}</p>{message && <p>{message}</p>}</div>;

  const photoPacket = files.length > 0 && files.every((file) => file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"));

  return <div className="form offerActions">
    <div className="offerRate"><small>PROOF OF DELIVERY</small><strong>Send signed POD</strong></div>

    <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => void addFiles(event.currentTarget.files)} />
    <input ref={libraryRef} hidden type="file" accept="application/pdf,image/*" multiple onChange={(event) => void addFiles(event.currentTarget.files)} />

    <button type="button" disabled={busy || preparing || files.length >= MAX_FILES || (files.length > 0 && !photoPacket)} onClick={() => cameraRef.current?.click()}>
      {preparing ? "Preparing photo…" : files.length > 0 && photoPacket ? "Take another POD photo" : "Take photo of POD"}
    </button>
    <button type="button" disabled={busy || preparing} onClick={() => libraryRef.current?.click()}>Choose existing photos or PDF</button>

    {files.length > 0 && <div style={{ display: "grid", gap: 10 }}>
      {files.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} style={{ border: "1px solid #d7dce3", borderRadius: 10, padding: 10 }}>
        {previews[index] ? <img src={previews[index] ?? ""} alt={`POD page ${index + 1} preview`} style={{ display: "block", width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8, marginBottom: 8 }} /> : <div style={{ padding: "18px 0", fontWeight: 700 }}>PDF document</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <span>{files.length > 1 ? `Page ${index + 1} · ` : ""}{file.name} · {(file.size / 1_000_000).toFixed(1)} MB</span>
          <button type="button" disabled={busy} onClick={() => removeFile(index)}>Remove</button>
        </div>
      </div>)}
    </div>}

    <button disabled={busy || preparing || files.length === 0} onClick={upload}>{busy ? "Validating POD…" : files.length > 1 ? `Submit ${files.length} POD pages & start billing` : "Submit POD & start billing"}</button>
    {message && <div className="offerMessage">{message}</div>}
    <p className="carrierFoot">Phone photos are optimized before upload. Up to 6 photos can be submitted as one POD packet. PDF, JPG, PNG, HEIC, and HEIF are accepted; 4 MB per file and 12 MB total.</p>
  </div>;
}
