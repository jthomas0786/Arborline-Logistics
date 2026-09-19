import { getPool } from "@/lib/db";

const USER_AGENT = "ArborLineConnect/1.0 (+https://www.arborlineconnect.com)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter"
];
const OVERPASS_RADII_METERS: readonly number[] = [15_000, 35_000];
const OVERPASS_RESULT_LIMIT = 24;

type ReplySampleContext = {
  reply_id: string;
  prospect_id: string;
  from_email: string;
  contact_name: string | null;
  company_name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  service_vertical: string | null;
};

type OSMElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string,string>;
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

type BuyerProfile = ReturnType<typeof buyerProfile>;
type BuyerSelector = BuyerProfile["selectors"][number];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function firstName(value: string | null | undefined) {
  return clean(value).split(/\s+/)[0] || "there";
}

function normalizeDomain(value: string | null | undefined) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function buyerProfile(verticalValue: string | null | undefined) {
  const vertical = clean(verticalValue).toLowerCase();
  const commonTitles = "Facilities Director, Property Manager, Operations Director, Procurement";
  if (vertical.includes("clean")) return {
    label: "Commercial Cleaning",
    target: "Commercial property managers, hotels, healthcare facilities, industrial sites, and other facilities that purchase recurring commercial cleaning services",
    titles: commonTitles,
    selectors: [
      ['office','property_management','Property management'], ['tourism','hotel','Hotel'],
      ['amenity','hospital','Healthcare'], ['amenity','clinic','Healthcare'], ['shop','mall','Retail center'],
      ['man_made','works','Industrial facility']
    ] as const
  };
  if (vertical.includes("hvac")) return {
    label: "HVAC",
    target: "Commercial property managers, hotels, healthcare facilities, manufacturing sites, warehouses, and retail facilities that maintain commercial HVAC systems",
    titles: commonTitles,
    selectors: [
      ['office','property_management','Property management'], ['tourism','hotel','Hotel'],
      ['amenity','hospital','Healthcare'], ['amenity','clinic','Healthcare'], ['man_made','works','Industrial facility'],
      ['shop','mall','Retail center']
    ] as const
  };
  if (vertical.includes("landscap")) return {
    label: "Landscaping",
    target: "Commercial property managers, hotels, campuses, healthcare facilities, and retail centers that purchase recurring grounds and landscape services",
    titles: commonTitles,
    selectors: [
      ['office','property_management','Property management'], ['tourism','hotel','Hotel'],
      ['amenity','hospital','Healthcare'], ['amenity','university','Campus'], ['shop','mall','Retail center']
    ] as const
  };
  if (vertical.includes("staff")) return {
    label: "Staffing",
    target: "Manufacturing, warehouse, logistics, distribution, and other operational employers that regularly need workforce capacity",
    titles: "Operations Director, Plant Manager, Warehouse Manager, HR Director, Procurement",
    selectors: [
      ['man_made','works','Manufacturing'], ['building','warehouse','Warehouse'],
      ['office','logistics','Logistics'], ['industrial','warehouse','Warehouse'], ['landuse','industrial','Industrial site']
    ] as const
  };
  if (vertical.includes("roof")) return {
    label: "Commercial Roofing",
    target: "Commercial property managers, industrial facilities, warehouses, hotels, and retail centers that maintain large commercial roofs",
    titles: commonTitles,
    selectors: [
      ['office','property_management','Property management'], ['man_made','works','Industrial facility'],
      ['building','warehouse','Warehouse'], ['tourism','hotel','Hotel'], ['shop','mall','Retail center']
    ] as const
  };
  if (vertical.includes("pest")) return {
    label: "Pest Control",
    target: "Hotels, food-service operators, property managers, warehouses, healthcare facilities, and other commercial sites that require recurring pest-control programs",
    titles: commonTitles,
    selectors: [
      ['tourism','hotel','Hotel'], ['amenity','restaurant','Food service'], ['office','property_management','Property management'],
      ['building','warehouse','Warehouse'], ['amenity','hospital','Healthcare']
    ] as const
  };
  if (vertical.includes("fire")) return {
    label: "Fire Protection",
    target: "Commercial property managers, warehouses, manufacturing sites, hotels, healthcare facilities, and retail centers that maintain fire-protection systems",
    titles: commonTitles,
    selectors: [
      ['office','property_management','Property management'], ['building','warehouse','Warehouse'], ['man_made','works','Industrial facility'],
      ['tourism','hotel','Hotel'], ['amenity','hospital','Healthcare'], ['shop','mall','Retail center']
    ] as const
  };
  if (vertical.includes("plumb")) return {
    label: "Commercial Plumbing",
    target: "Commercial property managers, hotels, healthcare facilities, industrial sites, warehouses, and retail centers that purchase commercial plumbing services",
    titles: commonTitles,
    selectors: [
      ['office','property_management','Property management'], ['tourism','hotel','Hotel'], ['amenity','hospital','Healthcare'],
      ['man_made','works','Industrial facility'], ['building','warehouse','Warehouse'], ['shop','mall','Retail center']
    ] as const
  };
  return {
    label: clean(verticalValue) || "Commercial Services",
    target: "Commercial facilities and operating businesses that are plausible buyers of the company's services",
    titles: commonTitles,
    selectors: [
      ['office','property_management','Property management'], ['tourism','hotel','Hotel'], ['amenity','hospital','Healthcare'],
      ['man_made','works','Industrial facility'], ['shop','mall','Retail center']
    ] as const
  };
}

async function geocode(city: string | null, state: string | null) {
  const place = [clean(city), clean(state), "USA"].filter(Boolean).join(", ");
  if (!place || place === "USA") return null;
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", place);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000), cache: "no-store"
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []) as Array<{lat?: string; lon?: string}>;
  const lat = Number(rows[0]?.lat);
  const lon = Number(rows[0]?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, place } : null;
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

function buildOverpassQuery(lat: number, lon: number, selector: BuyerSelector, radius: number) {
  const [key,value] = selector;
  const box = boundingBox(lat, lon, radius);
  const bbox = `${box.south.toFixed(6)},${box.west.toFixed(6)},${box.north.toFixed(6)},${box.east.toFixed(6)}`;
  return `[out:json][timeout:7];\nnwr["${key}"="${value}"]["name"](${bbox});\nout tags center qt ${OVERPASS_RESULT_LIMIT};`;
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
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store"
      });
      if (!response.ok) {
        const error = new Error(`OVERPASS_${response.status}`);
        lastError = error;
        if ([429, 502, 503, 504].includes(response.status)) continue;
        throw error;
      }
      const body = await response.json() as { elements?: OSMElement[] };
      return Array.isArray(body.elements) ? body.elements : [];
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("OVERPASS_FAILED");
    }
  }
  throw lastError ?? new Error("OVERPASS_FAILED");
}

function categoryFor(tags: Record<string,string>, selectors: readonly (readonly [string,string,string])[]) {
  for (const [key,value,label] of selectors) if (tags[key] === value) return label;
  return "Commercial facility";
}

function osmSourceUrl(element: OSMElement) {
  const type = element.type === "node" || element.type === "way" || element.type === "relation" ? element.type : "node";
  return `https://www.openstreetmap.org/${type}/${Number(element.id || 0)}`;
}

function buildMatches(
  elements: OSMElement[],
  profile: BuyerProfile,
  requesterDomain: string | null,
  city: string | null,
  state: string | null
) {
  const seen = new Set<string>();
  const candidates: PublicMatch[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const companyName = clean(tags.name);
    if (!companyName) continue;
    const website = clean(tags.website || tags["contact:website"] || tags.url) || null;
    const domain = normalizeDomain(website);
    if (requesterDomain && domain === requesterDomain) continue;
    const key = domain || companyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const category = categoryFor(tags, profile.selectors);
    const hasWebsite = Boolean(website && domain);
    candidates.push({
      companyName,
      website,
      domain,
      industry: category,
      city: clean(tags["addr:city"]) || clean(city) || null,
      state: clean(tags["addr:state"]) || clean(state) || null,
      sourceUrl: osmSourceUrl(element),
      score: hasWebsite ? 90 : 82,
      reasons: [
        `Public OpenStreetMap business/facility listing aligns with a typical ${profile.label} buyer profile.`,
        hasWebsite ? "A public company/facility website is listed for independent review." : "Public facility details are available for independent review."
      ]
    });
  }
  return candidates
    .sort((a,b) => (Number(Boolean(b.website)) - Number(Boolean(a.website))) || b.score - a.score || a.companyName.localeCompare(b.companyName))
    .slice(0, 5);
}

function elementKey(element: OSMElement) {
  return `${element.type || "node"}:${Number(element.id || 0)}`;
}

async function findPublicMatches(
  lat: number,
  lon: number,
  profile: BuyerProfile,
  requesterDomain: string | null,
  city: string | null,
  state: string | null
) {
  const collected = new Map<string, OSMElement>();
  let best: PublicMatch[] = [];
  let lastError: Error | null = null;
  let lastRadius: number = OVERPASS_RADII_METERS[0];

  for (const radius of OVERPASS_RADII_METERS) {
    lastRadius = radius;
    for (const selector of profile.selectors) {
      try {
        const elements = await fetchOverpass(buildOverpassQuery(lat, lon, selector, radius));
        for (const element of elements) collected.set(elementKey(element), element);
        const matches = buildMatches([...collected.values()], profile, requesterDomain, city, state);
        if (matches.length > best.length) best = matches;
        if (matches.length >= 3) return { matches, radius };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("OVERPASS_FAILED");
      }
    }
  }

  if (best.length >= 3) return { matches: best, radius: lastRadius };
  if (best.length > 0) throw new Error(`PUBLIC_SAMPLE_INSUFFICIENT_MATCHES_${best.length}`);
  throw lastError ?? new Error("PUBLIC_SAMPLE_INSUFFICIENT_MATCHES_0");
}

async function contextForReply(replyId: string) {
  const { rows } = await getPool().query<ReplySampleContext>(
    `SELECT r.id AS reply_id,r.prospect_id,r.from_email,p.contact_name,p.company_name,p.website,p.city,p.state,p.industry,
            s.service_vertical
     FROM connect_replies r
     JOIN connect_prospects p ON p.id=r.prospect_id
     LEFT JOIN connect_prospect_segments s ON s.id=p.segment_id
     WHERE r.id=$1 AND r.match_status='MATCHED' AND r.prospect_id IS NOT NULL
     LIMIT 1`,
    [replyId]
  );
  return rows[0] ?? null;
}

export async function prepareRequestedConnectSample(replyId: string) {
  const pool = getPool();
  const existing = await pool.query(
    `SELECT id,sample_status,sample_generation_error
     FROM connect_pilot_interest
     WHERE reply_id=$1 AND request_type='FREE_SAMPLE'
     LIMIT 1`,
    [replyId]
  );
  if (existing.rows[0]) {
    const countResult = await pool.query(
      `SELECT count(*)::int AS count FROM connect_free_sample_matches WHERE request_id=$1 AND selected=true`,
      [existing.rows[0].id]
    );
    return {
      prepared: true,
      alreadyPrepared: true,
      requestId: String(existing.rows[0].id),
      count: Number(countResult.rows[0]?.count || 0),
      status: existing.rows[0].sample_status,
      error: existing.rows[0].sample_generation_error ?? null
    };
  }

  const context = await contextForReply(replyId);
  if (!context) {
    return {
      prepared: false,
      alreadyPrepared: false,
      requestId: null,
      count: 0,
      status: "BLOCKED",
      error: "Matched reply is missing a linked outreach prospect."
    };
  }

  const profile = buyerProfile(context.service_vertical || context.industry);
  const serviceArea = [clean(context.city), clean(context.state)].filter(Boolean).join(", ") || "United States";
  const inserted = await pool.query(
    `INSERT INTO connect_pilot_interest
      (name,work_email,company_name,industry,service_area,website,notes,source,status,request_type,
       target_customer,decision_maker_titles,sample_status,sample_provider,sample_search_criteria,reply_id,prospect_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'OUTREACH_REPLY','QUALIFIED','FREE_SAMPLE',$8,$9,'IN_PROGRESS','OPENSTREETMAP_OVERPASS',$10::jsonb,$11,$12)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      clean(context.contact_name) || firstName(context.contact_name),
      context.from_email,
      context.company_name,
      profile.label,
      serviceArea,
      context.website,
      `Created from positive ArborLine outreach reply ${replyId}. Public-data sample only; no paid provider enrichment was used.`,
      profile.target,
      profile.titles,
      JSON.stringify({
        source: "OUTREACH_REPLY",
        provider: "OPENSTREETMAP_OVERPASS",
        serviceVertical: profile.label,
        geography: serviceArea,
        maxMatches: 5,
        searchStrategy: "INCREMENTAL_BBOX"
      }),
      replyId,
      context.prospect_id
    ]
  );

  let requestId = inserted.rows[0]?.id ? String(inserted.rows[0].id) : "";
  if (!requestId) {
    const raced = await pool.query(
      `SELECT id FROM connect_pilot_interest WHERE reply_id=$1 AND request_type='FREE_SAMPLE' LIMIT 1`,
      [replyId]
    );
    requestId = String(raced.rows[0]?.id || "");
  }
  if (!requestId) {
    return {
      prepared: false,
      alreadyPrepared: false,
      requestId: null,
      count: 0,
      status: "BLOCKED",
      error: "Unable to create a reply-linked free-sample request."
    };
  }

  try {
    const geo = await geocode(context.city, context.state);
    if (!geo) throw new Error("PUBLIC_SAMPLE_GEOCODE_FAILED");

    const matchResult = await findPublicMatches(
      geo.lat,
      geo.lon,
      profile,
      normalizeDomain(context.website),
      context.city,
      context.state
    );
    const matches = matchResult.matches;

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(`DELETE FROM connect_free_sample_matches WHERE request_id=$1`, [requestId]);
      for (const [index, match] of matches.entries()) {
        await db.query(
          `INSERT INTO connect_free_sample_matches
            (request_id,rank,company_name,website,domain,industry,city,state,country,source,source_url,match_score,match_reasons,selected)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'US','OPENSTREETMAP_OVERPASS',$9,$10,$11::jsonb,true)`,
          [
            requestId,
            index + 1,
            match.companyName,
            match.website,
            match.domain,
            match.industry,
            match.city,
            match.state,
            match.sourceUrl,
            match.score,
            JSON.stringify(match.reasons)
          ]
        );
      }
      await db.query(
        `UPDATE connect_pilot_interest
         SET sample_status='READY',sample_prepared_at=now(),sample_generated_at=now(),sample_generation_error=NULL,
             sample_search_criteria=coalesce(sample_search_criteria,'{}'::jsonb) || $2::jsonb,updated_at=now()
         WHERE id=$1`,
        [
          requestId,
          JSON.stringify({
            center: { place: geo.place },
            selectedMatches: matches.length,
            searchRadiusMeters: matchResult.radius
          })
        ]
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }

    return {
      prepared: true,
      alreadyPrepared: false,
      requestId,
      count: matches.length,
      status: "READY",
      error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Public sample generation failed.";
    console.error("[connect-reply-sample] public generation failed", {
      replyId,
      requestId,
      vertical: profile.label,
      city: context.city,
      state: context.state,
      message
    });
    await pool.query(
      `UPDATE connect_pilot_interest
       SET sample_status='REQUESTED',sample_generation_error=$2,sample_generated_at=now(),updated_at=now()
       WHERE id=$1`,
      [requestId, message]
    );
    return {
      prepared: true,
      alreadyPrepared: false,
      requestId,
      count: 0,
      status: "REQUESTED",
      error: message
    };
  }
}
