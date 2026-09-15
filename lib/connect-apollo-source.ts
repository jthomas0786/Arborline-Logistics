type ApolloOrganization = {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  city?: string;
  state?: string;
  country?: string;
  linkedin_url?: string;
};

export type ApolloCandidate = {
  company_name: string;
  website?: string;
  domain?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  employee_count?: number | null;
  location_count?: number | null;
  facility_type?: string;
  contact_name?: string;
  contact_title?: string;
  contact_email?: string;
  source: string;
  source_url?: string;
  buying_signals?: string[];
};

type ApolloIcp = {
  target_industries?: string[];
  target_geographies?: string[];
  min_employees?: number | null;
  max_employees?: number | null;
  facility_types?: string[];
  decision_maker_titles?: string[];
  buying_signals?: string[];
  limit?: number;
  page?: number;
};

const API_ROOT = "https://api.apollo.io/api/v1";
const HARD_MAX_ORGANIZATIONS_PER_RUN = 20;

function maxOrganizations() {
  const parsed = Number.parseInt(process.env.APOLLO_MAX_ORGS_PER_RUN || "20", 10);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), HARD_MAX_ORGANIZATIONS_PER_RUN)
    : HARD_MAX_ORGANIZATIONS_PER_RUN;
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), max) : fallback;
}

async function apolloPost<T>(path: string, body: Record<string, unknown>) {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) throw new Error("Apollo API key is not configured.");
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "cache-control": "no-cache",
      "x-api-key": key
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Apollo ${path} returned ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

function employeeRanges(min?: number | null, max?: number | null) {
  if (min == null && max == null) return undefined;
  const low = Math.max(min ?? 1, 1);
  const high = Math.max(max ?? Math.max(low, 100000), low);
  return [`${low},${high}`];
}

function firstStrings(values?: string[], max = 10) {
  return Array.isArray(values) ? values.map(String).map(v => v.trim()).filter(Boolean).slice(0, max) : [];
}

function sourcingKeywords(icp: ApolloIcp) {
  const configured = [...(icp.target_industries ?? []), ...(icp.facility_types ?? [])];
  const cleaningCampaign = configured.some(value => /clean|janitor/i.test(value));
  if (cleaningCampaign) {
    return [
      "commercial cleaning",
      "janitorial services",
      "office cleaning",
      "industrial cleaning",
      "commercial janitorial",
      "building cleaning services"
    ];
  }
  return firstStrings(configured, 12);
}

async function searchOrganizations(body: Record<string, unknown>) {
  try {
    return await apolloPost<{ organizations?: ApolloOrganization[] }>("/mixed_companies/search", body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes(" returned 403") && !message.includes(" returned 404")) throw error;
    return apolloPost<{ organizations?: ApolloOrganization[] }>("/organizations/search", body);
  }
}

export function apolloConfigured() {
  return Boolean(process.env.APOLLO_API_KEY?.trim());
}

export async function sourceFromApollo(icp: ApolloIcp): Promise<ApolloCandidate[]> {
  const limit = Math.min(maxOrganizations(), positiveInteger(icp.limit, maxOrganizations(), HARD_MAX_ORGANIZATIONS_PER_RUN));
  const page = positiveInteger(icp.page, 1, 100);
  const orgResult = await searchOrganizations({
    q_organization_keyword_tags: sourcingKeywords(icp),
    organization_locations: firstStrings(icp.target_geographies, 8),
    organization_num_employees_ranges: employeeRanges(icp.min_employees, icp.max_employees),
    page,
    per_page: limit
  });

  const organizations = (orgResult.organizations ?? []).slice(0, limit);
  return organizations
    .filter(organization => Boolean(organization.name))
    .map(organization => ({
      company_name: organization.name as string,
      website: organization.website_url,
      domain: organization.primary_domain,
      industry: organization.industry,
      city: organization.city,
      state: organization.state,
      country: organization.country || "US",
      employee_count: organization.estimated_num_employees ?? null,
      location_count: null,
      facility_type: icp.facility_types?.[0],
      source: "APOLLO",
      source_url: organization.linkedin_url || organization.website_url,
      buying_signals: firstStrings(icp.buying_signals, 10)
    }));
}