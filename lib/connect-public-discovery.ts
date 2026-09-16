import { getPool } from "@/lib/db";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";
import { researchPublicCompanySite } from "@/lib/connect-public-research";

const USER_AGENT = "ArborLineDiscovery/1.0 (+https://www.arborlineconnect.com)";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const HIGH_CONFIDENCE_THRESHOLD = 85;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC"
};
const STATE_BBOXES: Record<string, Array<{ name: string; south: number; west: number; north: number; east: number }>> = {
  IL: [
    { name: "northwest", south: 39.65, west: -91.60, north: 42.55, east: -89.45 },
    { name: "northeast", south: 39.65, west: -89.45, north: 42.55, east: -87.30 },
    { name: "southwest", south: 36.80, west: -91.60, north: 39.65, east: -89.45 },
    { name: "southeast", south: 36.80, west: -89.45, north: 39.65, east: -87.30 }
  ],
  IN: [
    { name: "northwest", south: 39.75, west: -88.20, north: 41.80, east: -86.40 },
    { name: "northeast", south: 39.75, west: -86.40, north: 41.80, east: -84.70 },
    { name: "southwest", south: 37.70, west: -88.20, north: 39.75, east: -86.40 },
    { name: "southeast", south: 37.70, west: -86.40, north: 39.75, east: -84.70 }
  ],
  WI: [
    { name: "northwest", south: 44.90, west: -92.95, north: 47.35, east: -89.60 },
    { name: "northeast", south: 44.90, west: -89.60, north: 47.35, east: -86.20 },
    { name: "southwest", south: 42.45, west: -92.95, north: 44.90, east: -89.60 },
    { name: "southeast", south: 42.45, west: -89.60, north: 44.90, east: -86.20 }
  ]
};

const BLOCKED_HOSTS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "yelp.com",
  "yellowpages.com", "google.com", "maps.google.com"
]);

type Segment = {
  id: string;
  client_id: string;
  slug: string;
  name: string;
  service_vertical: string;
  target_industries: string[] | null;
  target_geographies: string[] | null;
  min_employees: number | null;
  max_employees: number | null;
  min_locations: number | null;
  max_locations: number | null;
  facility_types: string[] | null;
  decision_maker_titles: string[] | null;
  buying_signals: string[] | null;
  exclusions: string[] | null;
  minimum_score: number | null;
};

type OsmElement = {
  type?: "node" | "way" | "relation";
  id?: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
};

type DiscoveryCandidate = {
  companyName: string;
  website: string;
  domain: string;
  city: string | null;
  state: string;
  industry: string;
  sourceUrl: string;
  metadata: Record<string, unknown>;
};

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function discoveryClientIds() {
  const raw = process.env.CONNECT_PUBLIC_DISCOVERY_CLIENT_IDS?.trim()
    || process.env.CONNECT_AUTOSEND_CLIENT_IDS?.trim()
    || "";
  return [...new Set(raw.split(",").map((value) => value.trim()).filter((value) => UUID.test(value)))];
}

export function publicDiscoveryEnabled() {
  return process.env.CONNECT_PUBLIC_DISCOVERY_ENABLED !== "false";
}

function stateCode(value: string) {
  const clean = value.trim();
  if (/^[A-Z]{2}$/i.test(clean)) return clean.toUpperCase();
  return STATE_CODES[clean.toLowerCase()] ?? null;
}

function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || BLOCKED_HOSTS.has(host) || [...BLOCKED_HOSTS].some((blocked) => host.endsWith(`.${blocked}`))) return null;
    return host;
  } catch {
    return null;
  }
}

function normalizeWebsite(value: string | null | undefined) {
  if (!value) return null;
  const clean = value.trim().split(/\s+/)[0];
  if (!clean) return null;
  try {
    const parsed = new URL(clean.includes("://") ? clean : `https://${clean}`);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const domain = normalizeDomain(parsed.hostname);
    if (!domain) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function exactTagSelectors(segment: Segment) {
  const vertical = `${segment.slug} ${segment.name} ${segment.service_vertical}`.toLowerCase();
  const tags: Array<[string, string]> = vertical.includes("hvac")
    ? [["craft", "hvac"], ["craft", "heating_engineer"], ["craft", "air_conditioning"]]
    : vertical.includes("roof")
      ? [["craft", "roofer"]]
      : vertical.includes("pest")
        ? [["office", "pest_control"], ["craft", "pest_control"]]
        : vertical.includes("fire protection") || vertical.includes("fire-protection") || vertical.includes("life safety")
          ? [["shop", "fire_protection"], ["office", "fire_protection"], ["craft", "fire_protection"]]
          : vertical.includes("plumb")
            ? [["craft", "plumber"]]
            : vertical.includes("landscap")
              ? [["craft", "landscaper"], ["craft", "gardener"]]
              : vertical.includes("staff")
                ? [["office", "employment_agency"], ["office", "recruitment"], ["office", "staffing"]]
                : vertical.includes("clean")
                  ? [["craft", "cleaning"], ["craft", "cleaner"]]
                  : [];

  return tags.flatMap(([key, value]) => [
    `["${key}"="${value}"]["website"]`,
    `["${key}"="${value}"]["contact:website"]`
  ]);
}

function overpassQuery(segment: Segment, geography: string, now: Date) {
  const code = stateCode(geography);
  const selectors = exactTagSelectors(segment);
  const boxes = code ? STATE_BBOXES[code] : null;
  if (!code || !selectors.length || !boxes?.length) return null;
  const epochDay = Math.floor(now.getTime() / 86_400_000);
  const regionIndex = ((epochDay % boxes.length) + boxes.length) % boxes.length;
  const region = boxes[regionIndex];
  const bbox = `${region.south},${region.west},${region.north},${region.east}`;
  const statements = selectors.map((selector) => `nwr${selector}(${bbox});`).join("\n");
  return {
    query: `[out:json][timeout:10];\n(\n${statements}\n);\nout tags center qt 60;`,
    region: { ...region, index: regionIndex, count: boxes.length }
  };
}

async function fetchOverpass(query: string) {
  let lastError = "No public discovery endpoint responded.";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": USER_AGENT,
          accept: "application/json"
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(18_000)
      });
      if (!response.ok) {
        lastError = `${new URL(endpoint).hostname} returned ${response.status}`;
        if ([429, 502, 503, 504].includes(response.status)) continue;
        throw new Error(lastError);
      }
      const json = await response.json() as { elements?: OsmElement[] };
      return { endpoint, elements: Array.isArray(json.elements) ? json.elements : [] };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Public discovery request failed.";
    }
  }
  throw new Error(lastError);
}

function candidateFromElement(element: OsmElement, segment: Segment, geography: string): DiscoveryCandidate | null {
  const tags = element.tags ?? {};
  const companyName = (tags.name || tags.brand || tags.operator || "").trim().slice(0, 180);
  if (!companyName) return null;
  const website = normalizeWebsite(tags.website || tags["contact:website"] || tags.url || tags["contact:url"]);
  if (!website) return null;
  const domain = normalizeDomain(website);
  if (!domain) return null;
  const city = (tags["addr:city"] || tags["contact:city"] || tags.city || "").trim().slice(0, 100) || null;
  const state = (tags["addr:state"] || geography).trim().slice(0, 100);
  const sourceUrl = element.type && element.id
    ? `https://www.openstreetmap.org/${element.type}/${element.id}`
    : website;
  const industry = (segment.target_industries?.[0] || segment.service_vertical || segment.name).slice(0, 140);
  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;
  return {
    companyName,
    website,
    domain,
    city,
    state,
    industry,
    sourceUrl,
    metadata: {
      discovery_provider: "OPENSTREETMAP_OVERPASS",
      discovery_source_url: sourceUrl,
      discovery_tags: Object.fromEntries(Object.entries(tags).slice(0, 35)),
      discovery_coordinates: lat !== null && lon !== null ? { lat, lon } : null,
      discovery_geography: geography,
      discovery_segment: segment.slug,
      discovery_checked_at: new Date().toISOString()
    }
  };
}

function profileFromSegment(segment: Segment): ConnectIcpProfile {
  return {
    target_industries: segment.target_industries ?? [],
    target_geographies: segment.target_geographies ?? [],
    min_employees: segment.min_employees,
    max_employees: segment.max_employees,
    min_locations: segment.min_locations,
    max_locations: segment.max_locations,
    facility_types: segment.facility_types ?? [],
    decision_maker_titles: segment.decision_maker_titles ?? [],
    buying_signals: segment.buying_signals ?? [],
    exclusions: segment.exclusions ?? [],
    minimum_score: segment.minimum_score ?? 70
  };
}

async function scoreStoredProspect(prospectId: string, segment: Segment) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.*, EXISTS (
       SELECT 1 FROM connect_suppressions s
       WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
         AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
           OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
     ) AS is_suppressed
     FROM connect_prospects p WHERE p.id=$1 LIMIT 1`,
    [prospectId]
  );
  const row = rows[0];
  if (!row) return null;
  const suppression = row.is_suppressed ? "DO_NOT_CONTACT" : row.suppression_status;
  const result = scoreConnectProspect({
    company_name: row.company_name,
    domain: row.domain,
    industry: row.industry,
    city: row.city,
    state: row.state,
    country: row.country,
    employee_count: row.employee_count,
    location_count: row.location_count,
    facility_type: row.facility_type,
    contact_title: row.contact_title,
    buying_signals: row.buying_signals,
    suppression_status: suppression
  }, profileFromSegment(segment));
  const outreach = result.status === "QUALIFIED" && row.contact_email ? "READY" : "NOT_READY";
  await pool.query(
    `UPDATE connect_prospects
     SET qualification_score=$2,qualification_status=$3,qualification_reasons=$4::jsonb,
         suppression_status=$5,outreach_status=$6,last_scored_at=now(),updated_at=now()
     WHERE id=$1`,
    [prospectId, result.score, result.status, JSON.stringify(result.reasons), suppression, outreach]
  );
  return result;
}

async function researchDiscoveredProspect(prospectId: string, segment: Segment) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id,domain FROM connect_prospects WHERE id=$1 LIMIT 1`, [prospectId]);
  const prospect = rows[0];
  if (!prospect?.domain) return { candidate: false, publishedEmail: false, highConfidence: false };
  const titles = (segment.decision_maker_titles ?? []).map(String).map((value) => value.trim()).filter(Boolean);
  if (!titles.length) return { candidate: false, publishedEmail: false, highConfidence: false };

  const result = await researchPublicCompanySite(String(prospect.domain), titles);
  const candidate = result.candidate;
  const highConfidence = Boolean(candidate && candidate.decisionMakerConfidence >= HIGH_CONFIDENCE_THRESHOLD && candidate.confidenceGrade === "HIGH");
  const metadata = {
    public_research_checked_at: new Date().toISOString(),
    public_research: {
      status: result.status,
      domain: result.domain,
      decision_maker_name: candidate?.name ?? null,
      decision_maker_title: candidate?.title ?? null,
      decision_maker_confidence: candidate?.decisionMakerConfidence ?? 0,
      decision_maker_confidence_grade: candidate?.confidenceGrade ?? "LOW",
      decision_maker_corroborating_pages: candidate?.corroboratingPages ?? 0,
      decision_maker_proximity: candidate?.proximity ?? null,
      published_email: candidate?.publishedEmail ?? null,
      email_status: candidate?.publishedEmail
        ? "PUBLISHED_UNVERIFIED"
        : candidate?.inferredEmailCandidates.length
          ? "INFERRED_UNVERIFIED"
          : "NONE",
      email_confidence: candidate?.emailConfidence ?? 0,
      inferred_email_candidates: candidate?.inferredEmailCandidates ?? [],
      published_company_emails: result.publishedEmails.slice(0, 12),
      source_url: candidate?.sourceUrl ?? null,
      pages_checked: result.pagesChecked.slice(0, 7),
      evidence: candidate?.evidence ?? [],
      robots_respected: result.robotsRespected,
      error: result.error ?? null
    }
  };

  await pool.query(
    `UPDATE connect_prospects
     SET contact_name=CASE WHEN contact_name IS NULL AND $2::text IS NOT NULL AND $4::int >= $6::int AND $7::boolean THEN $2 ELSE contact_name END,
         contact_title=CASE WHEN contact_title IS NULL AND $3::text IS NOT NULL AND $4::int >= $6::int AND $7::boolean THEN $3 ELSE contact_title END,
         source_metadata=coalesce(source_metadata,'{}'::jsonb) || $5::jsonb,
         updated_at=now()
     WHERE id=$1`,
    [prospectId, candidate?.name ?? null, candidate?.title ?? null, candidate?.decisionMakerConfidence ?? 0, JSON.stringify(metadata), HIGH_CONFIDENCE_THRESHOLD, highConfidence]
  );
  await scoreStoredProspect(prospectId, segment);
  return { candidate: Boolean(candidate), publishedEmail: Boolean(candidate?.publishedEmail), highConfidence };
}

export async function runPublicDiscoveryCycle(now = new Date()) {
  if (!publicDiscoveryEnabled()) return { state: "DISABLED" as const, inserted: 0, duplicates: 0 };
  const clientIds = discoveryClientIds();
  if (!clientIds.length) return { state: "NO_ALLOWLIST" as const, inserted: 0, duplicates: 0 };

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT s.*
     FROM connect_prospect_segments s
     JOIN connect_clients c ON c.id=s.client_id
     WHERE s.status='ACTIVE'
       AND c.status IN ('READY','ACTIVE','ONBOARDING')
       AND s.client_id=ANY($1::uuid[])
     ORDER BY s.client_id,s.slug`,
    [clientIds]
  );
  const segments = rows as Segment[];
  const slots = segments.flatMap((segment) =>
    (segment.target_geographies ?? [])
      .filter((geography) => Boolean(stateCode(String(geography))))
      .map((geography) => ({ segment, geography: String(geography) }))
  );
  if (!slots.length) return { state: "NO_ACTIVE_SLOTS" as const, inserted: 0, duplicates: 0 };

  const epochHour = Math.floor(now.getTime() / 3_600_000);
  const slotIndex = ((epochHour % slots.length) + slots.length) % slots.length;
  const { segment, geography } = slots[slotIndex];
  const query = overpassQuery(segment, geography, now);
  if (!query) return { state: "UNSUPPORTED_SLOT" as const, inserted: 0, duplicates: 0, segment: segment.slug, geography };

  const runResult = await pool.query(
    `INSERT INTO connect_sourcing_runs(client_id,segment_id,provider,status,request_payload,started_at)
     VALUES($1,$2,'ARBORLINE_PUBLIC_OSM','RUNNING',$3::jsonb,now()) RETURNING id`,
    [segment.client_id, segment.id, JSON.stringify({
      source: "OPENSTREETMAP_OVERPASS",
      queryMode: "STRUCTURED_TAGS_BBOX",
      region: query.region.name,
      regionIndex: query.region.index,
      regionCount: query.region.count,
      segment: segment.slug,
      geography,
      slotIndex,
      slotCount: slots.length,
      hourlyRotation: true
    })]
  );
  const runId = String(runResult.rows[0].id);

  try {
    const discovered = await fetchOverpass(query.query);
    const maxInsert = clamp(process.env.CONNECT_PUBLIC_DISCOVERY_BATCH_LIMIT, 1, 30, 15);
    const candidateMap = new Map<string, DiscoveryCandidate>();
    for (const element of discovered.elements) {
      const candidate = candidateFromElement(element, segment, geography);
      if (!candidate || candidateMap.has(candidate.domain)) continue;
      candidateMap.set(candidate.domain, candidate);
      if (candidateMap.size >= maxInsert * 3) break;
    }

    let inserted = 0;
    let duplicates = 0;
    let qualified = 0;
    const insertedIds: string[] = [];

    for (const candidate of [...candidateMap.values()].slice(0, maxInsert)) {
      const duplicate = await pool.query(
        `SELECT 1 FROM connect_prospects
         WHERE client_id=$1 AND (
           lower(domain)=lower($2)
           OR (lower(company_name)=lower($3) AND coalesce(lower(city),'')=coalesce(lower($4),''))
         ) LIMIT 1`,
        [segment.client_id, candidate.domain, candidate.companyName, candidate.city]
      );
      if (duplicate.rowCount) {
        duplicates++;
        continue;
      }

      const saved = await pool.query(
        `INSERT INTO connect_prospects(
           client_id,segment_id,company_name,website,domain,industry,city,state,country,
           source,source_url,buying_signals,enrichment_status,source_metadata
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'US','ARBORLINE_DISCOVERY',$9,'{}'::text[],'PARTIAL',$10::jsonb)
         RETURNING id`,
        [
          segment.client_id, segment.id, candidate.companyName, candidate.website, candidate.domain,
          candidate.industry, candidate.city, candidate.state, candidate.sourceUrl, JSON.stringify(candidate.metadata)
        ]
      );
      const id = String(saved.rows[0].id);
      insertedIds.push(id);
      inserted++;
      const score = await scoreStoredProspect(id, segment);
      if (score?.status === "QUALIFIED") qualified++;
    }

    const researchLimit = clamp(process.env.CONNECT_PUBLIC_DISCOVERY_RESEARCH_LIMIT, 0, 8, 4);
    let researched = 0;
    let researchCandidates = 0;
    let highConfidenceResearchCandidates = 0;
    let publishedEmailCandidates = 0;
    for (const id of insertedIds.slice(0, researchLimit)) {
      const research = await researchDiscoveredProspect(id, segment);
      researched++;
      if (research.candidate) researchCandidates++;
      if (research.highConfidence) highConfidenceResearchCandidates++;
      if (research.publishedEmail) publishedEmailCandidates++;
    }

    const postResearch = insertedIds.length
      ? await pool.query(
        `SELECT qualification_status,count(*)::int AS count
         FROM connect_prospects WHERE id=ANY($1::uuid[]) GROUP BY qualification_status`,
        [insertedIds]
      )
      : { rows: [] as Array<{ qualification_status: string; count: number }> };
    const statusCounts = Object.fromEntries(postResearch.rows.map((row) => [row.qualification_status, Number(row.count)]));

    await pool.query(
      `UPDATE connect_sourcing_runs
       SET status='COMPLETED',discovered_count=$2,inserted_count=$3,duplicate_count=$4,
           qualified_count=$5,completed_at=now()
       WHERE id=$1`,
      [runId, candidateMap.size, inserted, duplicates, Number(statusCounts.QUALIFIED ?? qualified)]
    );

    return {
      state: "COMPLETED" as const,
      runId,
      provider: "ARBORLINE_PUBLIC_OSM" as const,
      endpoint: new URL(discovered.endpoint).hostname,
      segment: segment.slug,
      segmentName: segment.name,
      geography,
      slotIndex,
      slotCount: slots.length,
      discovered: candidateMap.size,
      inserted,
      duplicates,
      researched,
      researchCandidates,
      highConfidenceResearchCandidates,
      publishedEmailCandidates,
      qualification: statusCounts
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Public discovery failed.";
    await pool.query(
      `UPDATE connect_sourcing_runs SET status='FAILED',error_message=$2,completed_at=now() WHERE id=$1`,
      [runId, message]
    );
    return {
      state: "FAILED" as const,
      runId,
      segment: segment.slug,
      geography,
      inserted: 0,
      duplicates: 0,
      error: message
    };
  }
}
