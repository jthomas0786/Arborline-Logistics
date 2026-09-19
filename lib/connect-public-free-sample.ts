import { getPool } from "@/lib/db";

const USER_AGENT = "ArborLineConnect/1.0 (+https://www.arborlineconnect.com)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter"
];
const SEARCH_RADII_METERS: readonly number[] = [15_000, 35_000];
const RESULT_LIMIT = 24;

type OSMElement = {
  type?: string;
  id?: number;
  tags?: Record<string,string>;
};

type BuyerProfile = {
  label: string;
  target: string;
  titles: string;
  selectors: readonly (readonly [string,string,string])[];
};

type PublicMatch = {
  companyName: string;
  website: string | null;
  domain: string | null;
  industry: string;
  city: string | null;
  state: string | null;
  sourceUrl: string;
  score: number;
  reasons: string[];
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDomain(value: unknown) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function buyerProfile(value: unknown): BuyerProfile {
  const vertical = clean(value).toLowerCase();
  const commonTitles = "Facilities Director, Property Manager, Operations Director, Procurement";
  if (vertical.includes("clean")) return {
    label: "Commercial Cleaning",
    target: "Commercial property managers, hotels, healthcare facilities, industrial sites, and other facilities that purchase recurring commercial cleaning services",
    titles: commonTitles,
    selectors: [
      ["office","property_management","Property management"], ["tourism","hotel","Hotel"],
      ["amenity","hospital","Healthcare"], ["amenity","clinic","Healthcare"],
      ["shop","mall","Retail center"], ["man_made","works","Industrial facility"]
    ]
  };
  if (vertical.includes("hvac")) return {
    label: "HVAC",
    target: "Commercial property managers, hotels, healthcare facilities, manufacturing sites, warehouses, and retail facilities that maintain commercial HVAC systems",
    titles: commonTitles,
    selectors: [
      ["office","property_management","Property management"], ["tourism","hotel","Hotel"],
      ["amenity","hospital","Healthcare"], ["amenity","clinic","Healthcare"],
      ["man_made","works","Industrial facility"], ["shop","mall","Retail center"]
    ]
  };
  if (vertical.includes("landscap")) return {
    label: "Landscaping",
    target: "Commercial property managers, hotels, campuses, healthcare facilities, and retail centers that purchase recurring grounds and landscape services",
    titles: commonTitles,
    selectors: [
      ["office","property_management","Property management"], ["tourism","hotel","Hotel"],
      ["amenity","hospital","Healthcare"], ["amenity","university","Campus"], ["shop","mall","Retail center"]
    ]
  };
  if (vertical.includes("staff")) return {
    label: "Staffing",
    target: "Manufacturing, warehouse, logistics, distribution, and other operational employers that regularly need workforce capacity",
    titles: "Operations Director, Plant Manager, Warehouse Manager, HR Director, Procurement",
    selectors: [
      ["man_made","works","Manufacturing"], ["building","warehouse","Warehouse"],
      ["office","logistics","Logistics"], ["landuse","industrial","Industrial site"]
    ]
  };
  if (vertical.includes("roof")) return {
    label: "Commercial Roofing",
    target: "Commercial property managers, industrial facilities, warehouses, hotels, and retail centers that maintain large commercial roofs",
    titles: commonTitles,
    selectors: [
      ["office","property_management","Property management"], ["man_made","works","Industrial facility"],
      ["building","warehouse","Warehouse"], ["tourism","hotel","Hotel"], ["shop","mall","Retail center"]
    ]
  };
  if (vertical.includes("pest")) return {
    label: "Pest Control",
    target: "Hotels, food-service operators, property managers, warehouses, healthcare facilities, and other commercial sites that require recurring pest-control programs",
    titles: commonTitles,
    selectors: [
      ["tourism","hotel","Hotel"], ["amenity","restaurant","Food service"],
      ["office","property_management","Property management"], ["building","warehouse","Warehouse"],
      ["amenity","hospital","Healthcare"]
    ]
  };
  if (vertical.includes("fire")) return {
    label: "Fire Protection",
    target: "Commercial property managers, warehouses, manufacturing sites, hotels, healthcare facilities, and retail centers that maintain fire-protection systems",
    titles: commonTitles,
    selectors: [
      ["office","property_management","Property management"], ["building","warehouse","Warehouse"],
      ["man_made","works","Industrial facility"], ["tourism","hotel","Hotel"],
      ["amenity","hospital","Healthcare"], ["shop","mall","Retail center"]
    ]
  };
  if (vertical.includes("plumb")) return {
    label: "Commercial Plumbing",
    target: "Commercial property managers, hotels, healthcare facilities, industrial sites, warehouses, and retail centers that purchase commercial plumbing services",
    titles: commonTitles,
    selectors: [
      ["office","property_management","Property management"], ["tourism","hotel","Hotel"],
      ["amenity","hospital","Healthcare"], ["man_made","works","Industrial facility"],
      ["building","warehouse","Warehouse"], ["shop","mall","Retail center"]
    ]
  };
  return {
    label: clean(value) || "Commercial Services",
    target: "Commercial facilities and operating businesses that are plausible buyers of the requester's services",
    titles: commonTitles,
    selectors: [
      ["office","property_management","Property management"], ["tourism","hotel","Hotel"],
      ["amenity","hospital","Healthcare"], ["amenity","clinic","Healthcare"],
      ["man_made","works","Industrial facility"], ["shop","mall","Retail center"]
    ]
  };
}

function normalizedSearchArea(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  if (/\b(nationwide|united states|usa|u\.s\.)\b/i.test(raw)) return "";
  return raw
    .replace(/\bwithin\s+\d+\s*(?:mile|miles|mi)\b.*$/i, "")
    .replace(/\b\d+\s*(?:mile|miles|mi)[-\s]*(?:radius)?\b/gi, "")
    .replace(/\bmetro(?:politan)?\s+area\b/gi, "")
    .replace(/\bmetro\b/gi, "")
    .replace(/\bservice\s+area\b/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/,$/, "");
}

async function geocodeArea(value: unknown) {
  const area = normalizedSearchArea(value);
  if (!area) throw new Error("PUBLIC_SAMPLE_LOCAL_GEOGRAPHY_REQUIRED");
  const place = `${area}, USA`;
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", place);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`PUBLIC_SAMPLE_GEOCODE_${response.status}`);
  const rows = await response.json().catch(() => []) as Array<{lat?: string;lon?: string;display_name?: string}>;
  const lat = Number(rows[0]?.lat);
  const lon = Number(rows[0]?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("PUBLIC_SAMPLE_GEOCODE_FAILED");
  return { lat, lon, place: clean(rows[0]?.display_name) || place, requestedArea: area };
}

function boundingBox(lat: number, lon: number, radiusMeters: number) {
  const latDelta = radiusMeters / 111_320;
  const cosine = Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const lonDelta = radiusMeters / (111_320 * cosine);
  return {
    south: lat - latDelta,
    west: lon - lonDelta,
    north: lat + latDelta,
    east: lon + lonDelta
  };
}

function buildQuery(lat: number, lon: number, selector: readonly [string,string,string], radius: number) {
  const [key,value] = selector;
  const box = boundingBox(lat,lon,radius);
  const bbox = `${box.south.toFixed(6)},${box.west.toFixed(6)},${box.north.toFixed(6)},${box.east.toFixed(6)}`;
  return `[out:json][timeout:7];\nnwr["${key}"="${value}"]["name"](${bbox});\nout tags center qt ${RESULT_LIMIT};`;
}

async function fetchOverpass(query: string) {
  let lastError: Error | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json"
        },
        body: new URLSearchParams({data:query}).toString(),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store"
      });
      if (!response.ok) {
        lastError = new Error(`OVERPASS_${response.status}`);
        if ([429,502,503,504].includes(response.status)) continue;
        throw lastError;
      }
      const body = await response.json() as {elements?: OSMElement[]};
      return Array.isArray(body.elements) ? body.elements : [];
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("OVERPASS_FAILED");
    }
  }
  throw lastError ?? new Error("OVERPASS_FAILED");
}

function categoryFor(tags: Record<string,string>, selectors: BuyerProfile["selectors"]) {
  for (const [key,value,label] of selectors) if (tags[key] === value) return label;
  return "Commercial facility";
}

function sourceUrl(element: OSMElement) {
  const type = element.type === "node" || element.type === "way" || element.type === "relation" ? element.type : "node";
  return `https://www.openstreetmap.org/${type}/${Number(element.id || 0)}`;
}

function elementKey(element: OSMElement) {
  return `${element.type || "node"}:${Number(element.id || 0)}`;
}

function buildMatches(elements: OSMElement[], profile: BuyerProfile, requesterDomain: string | null) {
  const seen = new Set<string>();
  const matches: PublicMatch[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const companyName = clean(tags.name);
    if (!companyName) continue;
    const website = clean(tags.website || tags["contact:website"] || tags.url) || null;
    const domain = normalizeDomain(website);
    if (requesterDomain && domain === requesterDomain) continue;
    const key = domain || companyName.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const category = categoryFor(tags, profile.selectors);
    const hasWebsite = Boolean(website && domain);
    matches.push({
      companyName,
      website,
      domain,
      industry: category,
      city: clean(tags["addr:city"]) || null,
      state: clean(tags["addr:state"]) || null,
      sourceUrl: sourceUrl(element),
      score: hasWebsite ? 90 : 82,
      reasons: [
        `${category} fits a typical buyer profile for ${profile.label}.`,
        hasWebsite ? "Public business/facility listing includes a website for independent review." : "Public facility listing provides independently reviewable location evidence.",
        `Likely buyer roles: ${profile.titles}.`
      ]
    });
  }
  return matches
    .sort((a,b) => Number(Boolean(b.website)) - Number(Boolean(a.website)) || b.score - a.score || a.companyName.localeCompare(b.companyName))
    .slice(0,5);
}

async function findMatches(lat: number,lon: number,profile: BuyerProfile,requesterDomain: string | null) {
  const collected = new Map<string,OSMElement>();
  let best: PublicMatch[] = [];
  let lastError: Error | null = null;
  let lastRadius = SEARCH_RADII_METERS[0];
  for (const radius of SEARCH_RADII_METERS) {
    lastRadius = radius;
    for (const selector of profile.selectors) {
      try {
        const elements = await fetchOverpass(buildQuery(lat,lon,selector,radius));
        for (const element of elements) collected.set(elementKey(element),element);
        const matches = buildMatches([...collected.values()],profile,requesterDomain);
        if (matches.length > best.length) best = matches;
        if (matches.length >= 3) return {matches,radius};
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("OVERPASS_FAILED");
      }
    }
  }
  if (best.length >= 3) return {matches:best,radius:lastRadius};
  if (best.length) throw new Error(`PUBLIC_SAMPLE_INSUFFICIENT_MATCHES_${best.length}`);
  throw lastError ?? new Error("PUBLIC_SAMPLE_INSUFFICIENT_MATCHES_0");
}

export async function generatePublicFreeSampleMatches(requestId: string) {
  const pool = getPool();
  const requestResult = await pool.query(
    `SELECT id,company_name,industry,service_area,target_customer,decision_maker_titles,website,
            sample_status,sample_approved_at
     FROM connect_pilot_interest
     WHERE id=$1 AND request_type='FREE_SAMPLE'
     LIMIT 1`,
    [requestId]
  );
  const request = requestResult.rows[0];
  if (!request) throw new Error("SAMPLE_REQUEST_NOT_FOUND");
  if (request.sample_approved_at) throw new Error("SAMPLE_ALREADY_APPROVED");
  if (!new Set(["REQUESTED","READY"]).has(String(request.sample_status || ""))) {
    throw new Error(String(request.sample_status) === "IN_PROGRESS" ? "SAMPLE_GENERATION_ALREADY_RUNNING" : "SAMPLE_GENERATION_NOT_ALLOWED");
  }

  const profile = buyerProfile(`${clean(request.industry)} ${clean(request.target_customer)}`);
  const claimed = await pool.query(
    `UPDATE connect_pilot_interest
     SET sample_status='IN_PROGRESS',sample_provider='OPENSTREETMAP_OVERPASS',
         sample_search_criteria=coalesce(sample_search_criteria,'{}'::jsonb) || $2::jsonb,
         sample_generation_error=NULL,updated_at=now()
     WHERE id=$1 AND request_type='FREE_SAMPLE' AND sample_status IN ('REQUESTED','READY')
       AND sample_approved_at IS NULL
     RETURNING id`,
    [requestId,JSON.stringify({
      provider:"OPENSTREETMAP_OVERPASS",
      serviceVertical:profile.label,
      targetCustomer:clean(request.target_customer) || profile.target,
      likelyBuyerTitles:clean(request.decision_maker_titles) || profile.titles,
      geography:clean(request.service_area),
      maxMatches:5,
      searchStrategy:"INCREMENTAL_BBOX",
      paidProviderUsed:false
    })]
  );
  if (!claimed.rows[0]) throw new Error("SAMPLE_GENERATION_ALREADY_RUNNING");

  try {
    const geo = await geocodeArea(request.service_area);
    const result = await findMatches(geo.lat,geo.lon,profile,normalizeDomain(request.website));
    const matches = result.matches;
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(`DELETE FROM connect_free_sample_matches WHERE request_id=$1`,[requestId]);
      for (const [index,match] of matches.entries()) {
        await db.query(
          `INSERT INTO connect_free_sample_matches
            (request_id,rank,company_name,website,domain,industry,city,state,country,source,source_url,match_score,match_reasons,selected)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'US','OPENSTREETMAP_OVERPASS',$9,$10,$11::jsonb,true)`,
          [requestId,index+1,match.companyName,match.website,match.domain,match.industry,match.city,match.state,match.sourceUrl,match.score,JSON.stringify(match.reasons)]
        );
      }
      await db.query(
        `UPDATE connect_pilot_interest
         SET sample_status='READY',sample_provider='OPENSTREETMAP_OVERPASS',
             sample_prepared_at=COALESCE(sample_prepared_at,now()),sample_generated_at=now(),
             sample_generation_error=NULL,
             sample_search_criteria=coalesce(sample_search_criteria,'{}'::jsonb) || $2::jsonb,
             updated_at=now()
         WHERE id=$1 AND request_type='FREE_SAMPLE' AND sample_approved_at IS NULL`,
        [requestId,JSON.stringify({
          center:{place:geo.place,requestedArea:geo.requestedArea},
          selectedMatches:matches.length,
          searchRadiusMeters:result.radius,
          provider:"OPENSTREETMAP_OVERPASS",
          paidProviderUsed:false
        })]
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    return {count:matches.length,provider:"OPENSTREETMAP_OVERPASS" as const,paidProviderUsed:false};
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,500) : "Public sample generation failed.";
    await pool.query(
      `UPDATE connect_pilot_interest
       SET sample_status='REQUESTED',sample_provider='OPENSTREETMAP_OVERPASS',sample_generation_error=$2,
           sample_generated_at=now(),updated_at=now()
       WHERE id=$1 AND request_type='FREE_SAMPLE' AND sample_approved_at IS NULL`,
      [requestId,message]
    );
    throw error;
  }
}
