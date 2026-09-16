export type ConnectServiceFitStatus = "MATCH" | "REVIEW" | "MISMATCH" | "UNVERIFIED";

export type ConnectServiceFitResult = {
  status: ConnectServiceFitStatus;
  matchedTerms: string[];
  commercialSignals: string[];
  mismatchSignals: string[];
  pagesMatched: string[];
  evidence: string[];
};

type ServicePage = { url: string; text: string };
type ServiceRule = {
  core: string[];
  commercialRequired?: boolean;
  commercialSignals?: string[];
  mismatch: string[];
};

const DEFAULT_COMMERCIAL_SIGNALS = [
  "commercial", "business", "businesses", "property management", "property managers",
  "facility", "facilities", "industrial", "office", "offices", "warehouse", "warehouses",
  "retail", "restaurant", "restaurants", "multifamily", "municipal", "institutional"
];

const COMMON_MISMATCH = [
  "training center", "trade school", "academy", "supplier", "supply company", "wholesale",
  "manufacturer", "manufacturing", "distributor", "distribution center", "association",
  "software platform", "marketplace"
];

const RULES: Record<string, ServiceRule> = {
  "commercial-cleaning": {
    core: [
      "commercial cleaning", "janitorial", "office cleaning", "facility cleaning", "building cleaning",
      "industrial cleaning", "commercial janitorial", "day porter", "floor care"
    ],
    commercialRequired: true,
    mismatch: ["house cleaning only", "residential cleaning only", ...COMMON_MISMATCH]
  },
  "commercial-plumbing": {
    core: [
      "commercial plumbing", "plumbing contractor", "plumbing services", "plumber", "drain cleaning",
      "sewer repair", "water heater", "backflow", "pipe repair", "hydro jetting"
    ],
    commercialRequired: true,
    mismatch: ["plumbing supply", "plumbing school", ...COMMON_MISMATCH]
  },
  "commercial-roofing": {
    core: [
      "commercial roofing", "roofing contractor", "roof repair", "roof replacement", "flat roof",
      "tpo roofing", "epdm", "roof coating", "metal roofing", "roof maintenance"
    ],
    commercialRequired: true,
    mismatch: ["roofing supply", "roofing school", "roofing academy", "roofing materials", ...COMMON_MISMATCH]
  },
  "fire-protection": {
    core: [
      "fire protection", "fire sprinkler", "fire alarm", "fire extinguisher", "fire suppression",
      "life safety", "sprinkler inspection", "fire inspection", "fire pump"
    ],
    mismatch: ["security only", "security monitoring", ...COMMON_MISMATCH]
  },
  hvac: {
    core: [
      "hvac", "heating and cooling", "air conditioning", "furnace", "heat pump",
      "commercial heating", "mechanical services", "ac repair"
    ],
    mismatch: ["hvac school", "hvac training", "hvac supply", ...COMMON_MISMATCH]
  },
  landscaping: {
    core: [
      "landscaping", "landscape maintenance", "lawn care", "grounds maintenance", "hardscape",
      "landscape design", "commercial landscape", "snow removal"
    ],
    mismatch: ["landscape supply", "garden center", "nursery only", ...COMMON_MISMATCH]
  },
  "pest-control": {
    core: [
      "pest control", "pest management", "exterminator", "exterminating", "termite", "bed bug",
      "rodent control", "wildlife removal", "mosquito control"
    ],
    mismatch: ["damage restoration", "home cleaning", "pest control products", ...COMMON_MISMATCH]
  },
  staffing: {
    core: [
      "staffing", "recruiting", "employment agency", "temporary staffing", "workforce solutions",
      "job placement", "talent acquisition", "temp agency", "direct hire"
    ],
    mismatch: ["staffing software", "recruiting software", "job board only", ...COMMON_MISMATCH]
  }
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeConnectServiceFitStatus(value: unknown): ConnectServiceFitStatus {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "MATCH" || normalized === "REVIEW" || normalized === "MISMATCH" || normalized === "UNVERIFIED") {
    return normalized;
  }
  return "UNVERIFIED";
}

function hits(text: string, terms: string[]) {
  const found = new Set<string>();
  for (const term of terms) {
    const normalized = normalize(term);
    if (normalized && text.includes(normalized)) found.add(term);
  }
  return [...found];
}

function matchingPages(pages: ServicePage[], terms: string[]) {
  if (!terms.length) return [];
  const urls = new Set<string>();
  for (const page of pages) {
    const text = normalize(page.text);
    if (terms.some((term) => text.includes(normalize(term)))) urls.add(page.url);
  }
  return [...urls].slice(0, 7);
}

export function evaluateConnectServiceFit(
  segmentSlug: string | null | undefined,
  pages: ServicePage[],
  targetIndustries: string[] = []
): ConnectServiceFitResult {
  const slug = String(segmentSlug ?? "").trim().toLowerCase();
  if (!pages.length) {
    return {
      status: "UNVERIFIED",
      matchedTerms: [],
      commercialSignals: [],
      mismatchSignals: [],
      pagesMatched: [],
      evidence: ["No readable company-site pages were available to verify service fit."]
    };
  }

  const rule = RULES[slug];
  const genericCore = targetIndustries.map(String).map((value) => value.trim()).filter(Boolean);
  const coreTerms = rule?.core?.length ? rule.core : genericCore;
  if (!coreTerms.length) {
    return {
      status: "UNVERIFIED",
      matchedTerms: [],
      commercialSignals: [],
      mismatchSignals: [],
      pagesMatched: [],
      evidence: ["No service-fit rule or target-industry terms were available for this segment."]
    };
  }

  const siteText = normalize(pages.map((page) => page.text).join("\n"));
  const matchedTerms = hits(siteText, coreTerms);
  const mismatchSignals = hits(siteText, rule?.mismatch ?? COMMON_MISMATCH);
  const commercialSignals = hits(siteText, rule?.commercialSignals ?? DEFAULT_COMMERCIAL_SIGNALS);
  const pagesMatched = matchingPages(pages, matchedTerms);

  if (!matchedTerms.length) {
    if (mismatchSignals.length) {
      return {
        status: "MISMATCH",
        matchedTerms,
        commercialSignals,
        mismatchSignals,
        pagesMatched,
        evidence: [
          "The company site did not show the segment's target service.",
          `Conflicting business signals were found: ${mismatchSignals.slice(0, 5).join(", ")}.`
        ]
      };
    }
    return {
      status: "REVIEW",
      matchedTerms,
      commercialSignals,
      mismatchSignals,
      pagesMatched,
      evidence: ["The company site was reachable, but the target service could not be confirmed from the checked pages."]
    };
  }

  if (rule?.commercialRequired && !commercialSignals.length) {
    return {
      status: "REVIEW",
      matchedTerms,
      commercialSignals,
      mismatchSignals,
      pagesMatched,
      evidence: [
        `Service evidence was found: ${matchedTerms.slice(0, 6).join(", ")}.`,
        "The segment requires commercial service evidence, but no clear commercial/business-service signal was found."
      ]
    };
  }

  return {
    status: "MATCH",
    matchedTerms,
    commercialSignals,
    mismatchSignals,
    pagesMatched,
    evidence: [
      `Verified service evidence: ${matchedTerms.slice(0, 6).join(", ")}.`,
      ...(rule?.commercialRequired
        ? [`Verified commercial-service signals: ${commercialSignals.slice(0, 6).join(", ")}.`]
        : [])
    ]
  };
}
