const FMCSA_BASE = "https://mobile.fmcsa.dot.gov/qc/services";

export type FmcsaSnapshot = {
  source: "FMCSA_QCMOBILE";
  dotNumber: string;
  mcNumber: string | null;
  legalName: string;
  dbaName: string | null;
  allowToOperate: boolean;
  outOfService: boolean;
  outOfServiceDate: string | null;
  authorityActive: boolean;
  fetchedAt: string;
  summary: Record<string, unknown>;
};

export class FmcsaNotConfiguredError extends Error {
  constructor() {
    super("FMCSA_WEB_KEY_NOT_CONFIGURED");
    this.name = "FmcsaNotConfiguredError";
  }
}

function normalizeDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function allObjects(value: unknown, output: Record<string, unknown>[] = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) allObjects(item, output);
    return output;
  }
  const object = value as Record<string, unknown>;
  output.push(object);
  for (const child of Object.values(object)) allObjects(child, output);
  return output;
}

function valueByKey(value: unknown, keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const object of allObjects(value)) {
    for (const [key, entry] of Object.entries(object)) {
      if (wanted.has(key.toLowerCase()) && entry !== null && entry !== undefined && String(entry).trim() !== "") return entry;
    }
  }
  return null;
}

function yes(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ["Y", "YES", "TRUE", "1"].includes(normalized);
}

function findCarrierObject(value: unknown, dotNumber: string) {
  const objects = allObjects(value);
  return objects.find((object) => normalizeDigits(object.dotNumber ?? object.dot_number ?? object.usdotNumber) === dotNumber)
    ?? objects.find((object) => typeof object.legalName === "string" || typeof object.legal_name === "string")
    ?? null;
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json", "user-agent": "Arborline-Logistics/1.0 carrier-compliance" }
  });
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`FMCSA_QCMOBILE_${response.status}`);
  return body;
}

export async function fetchFmcsaSnapshot(usdotNumber: string): Promise<FmcsaSnapshot> {
  const webKey = process.env.FMCSA_WEB_KEY?.trim();
  if (!webKey) throw new FmcsaNotConfiguredError();
  const dotNumber = normalizeDigits(usdotNumber);
  if (!/^\d{1,10}$/.test(dotNumber)) throw new Error("INVALID_USDOT_NUMBER");

  const encodedKey = encodeURIComponent(webKey);
  const [carrierBody, authorityBody, docketBody] = await Promise.all([
    fetchJson(`${FMCSA_BASE}/carriers/${dotNumber}?webKey=${encodedKey}`),
    fetchJson(`${FMCSA_BASE}/carriers/${dotNumber}/authority?webKey=${encodedKey}`).catch((error) => ({ authorityError: error instanceof Error ? error.message : "UNKNOWN" })),
    fetchJson(`${FMCSA_BASE}/carriers/${dotNumber}/docket-numbers?webKey=${encodedKey}`).catch((error) => ({ docketError: error instanceof Error ? error.message : "UNKNOWN" }))
  ]);

  const carrier = findCarrierObject(carrierBody, dotNumber);
  if (!carrier) throw new Error("FMCSA_CARRIER_NOT_FOUND");

  const legalName = String(valueByKey(carrier, ["legalName", "legal_name"]) ?? "").trim();
  if (!legalName) throw new Error("FMCSA_LEGAL_NAME_MISSING");
  const dbaNameValue = valueByKey(carrier, ["dbaName", "dba_name"]);
  const allowValue = valueByKey(carrierBody, ["allowToOperate", "allowedToOperate"]);
  const oosValue = valueByKey(carrierBody, ["outOfService", "out_of_service"]);
  const oosDateValue = valueByKey(carrierBody, ["outOfServiceDate", "out_of_service_date"]);
  const mcValue = valueByKey(carrierBody, ["mcNumber", "mc_number"])
    ?? valueByKey(docketBody, ["docketNumber", "docket_number", "mcNumber", "mc_number"]);

  const allowToOperate = yes(allowValue);
  const outOfService = yes(oosValue);
  const authorityActive = allowToOperate && !outOfService;
  const fetchedAt = new Date().toISOString();

  return {
    source: "FMCSA_QCMOBILE",
    dotNumber,
    mcNumber: normalizeDigits(mcValue) || null,
    legalName,
    dbaName: dbaNameValue ? String(dbaNameValue).trim() : null,
    allowToOperate,
    outOfService,
    outOfServiceDate: oosDateValue ? String(oosDateValue).trim() : null,
    authorityActive,
    fetchedAt,
    summary: {
      dotNumber,
      mcNumber: normalizeDigits(mcValue) || null,
      legalName,
      dbaName: dbaNameValue ? String(dbaNameValue).trim() : null,
      allowToOperate,
      outOfService,
      outOfServiceDate: oosDateValue ? String(oosDateValue).trim() : null,
      authorityEndpointAvailable: !(authorityBody && typeof authorityBody === "object" && "authorityError" in authorityBody),
      docketEndpointAvailable: !(docketBody && typeof docketBody === "object" && "docketError" in docketBody),
      fetchedAt
    }
  };
}
