from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one anchor in {path}, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


def replace_count(path: str, old: str, new: str, expected: int):
    p = Path(path)
    text = p.read_text()
    if old not in text and new in text:
        return
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"expected {expected} anchors in {path}, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new))


public = "lib/connect-public-research.ts"

replace_once(
    public,
    'const NON_PERSON_TERMS = new Set([',
    '''const US_STATE_NAMES = new Set([\n  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",\n  "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",\n  "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",\n  "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma",\n  "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah",\n  "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming"\n]);\nconst GEO_DIRECTION_WORDS = new Set([\n  "north", "south", "east", "west", "central", "northern", "southern", "eastern", "western", "northeast",\n  "northwest", "southeast", "southwest", "metro", "greater", "midwest", "midwestern", "region", "regional"\n]);\n\nconst NON_PERSON_TERMS = new Set(['''
)

replace_once(
    public,
    'function looksLikePersonName(value: string) {',
    '''function looksLikeGeographyLabel(value: string) {\n  const normalized = normalizeTitle(cleanName(value));\n  if (!normalized) return false;\n  if (US_STATE_NAMES.has(normalized)) return true;\n  const words = normalized.split(" ").filter(Boolean);\n  if (words.length < 2 || words.length > 4) return false;\n  const hasDirection = words.some((word) => GEO_DIRECTION_WORDS.has(word));\n  const hasState = [...US_STATE_NAMES].some((state) => normalized === state || normalized.endsWith(` ${state}`));\n  const hasRegionWord = words.some((word) => ["region", "regional", "metro", "area", "territory"].includes(word));\n  return (hasDirection && hasState) || (hasDirection && hasRegionWord);\n}\n\nfunction classifyRejectedPersonName(value: string) {\n  const name = cleanName(value);\n  if (!name || name.length < 4 || name.length > 70) return "LENGTH_OR_EMPTY";\n  if (/[!?=<>/@]/.test(name)) return "SYMBOL_OR_URL";\n  const words = name.split(" ").filter(Boolean);\n  if (words.length < 2 || words.length > 5) return "TOKEN_COUNT";\n  if (words.some((word) => /\\d|https?|www\\./i.test(word))) return "DIGIT_OR_URL";\n  if (words.some((word) => /^[A-Z]{2}$/.test(word) && US_STATE_CODES.has(word))) return "STATE_CODE_LABEL";\n  if (looksLikeGeographyLabel(name)) return "GEOGRAPHY_LABEL";\n  const normalized = words.map((word) => word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ""));\n  if (normalized.some((word) => NON_PERSON_TERMS.has(word))) return "NON_PERSON_TERM";\n  if (NON_PERSON_PHRASES.some((phrase) => normalizeTitle(name).includes(phrase))) return "NON_PERSON_PHRASE";\n  if (words.some((word) => !titleCaseNameToken(word) && !NAME_PARTICLES.has(word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "")) && !HONORIFICS.has(word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "")) && !NAME_SUFFIXES.has(word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "")))) return "CASE_OR_TOKEN_SHAPE";\n  return "OTHER";\n}\n\nfunction looksLikePersonName(value: string) {'''
)

replace_once(
    public,
    '  if (words.some((word) => /^[A-Z]{2}$/.test(word) && US_STATE_CODES.has(word))) return false;\n',
    '  if (words.some((word) => /^[A-Z]{2}$/.test(word) && US_STATE_CODES.has(word))) return false;\n  if (looksLikeGeographyLabel(name)) return false;\n'
)

replace_once(
    public,
    '''      if (!looksLikePersonName(name)) {\n        reject("STRUCTURED_PERSON_INVALID_NAME");\n        continue;\n      }''',
    '''      if (!looksLikePersonName(name)) {\n        reject(`STRUCTURED_PERSON_INVALID_NAME_${classifyRejectedPersonName(name)}`);\n        continue;\n      }'''
)

replace_once(
    public,
    '''      if (!looksLikePersonName(name)) {\n        reject("MAILTO_PERSON_ANCHOR_VISIBLE_TEXT_NOT_PERSON_NAME");\n        continue;\n      }''',
    '''      if (!looksLikePersonName(name)) {\n        reject(`MAILTO_PERSON_ANCHOR_VISIBLE_TEXT_NOT_PERSON_NAME_${classifyRejectedPersonName(name)}`);\n        continue;\n      }'''
)

replace_once(
    public,
    '''    fetchFailures: number;\n    contentTypeRejected: number;\n    deadlineExceeded: boolean;''',
    '''    fetchFailures: number;\n    fetchFailureReasons: Record<string, number>;\n    fetchFailureStatusCodes: Record<string, number>;\n    fetchFailureSamples: Array<{ url: string; reason: string; status: number | null }>;\n    lowValueUrlsSkipped: number;\n    highValueUrlsPrioritized: number;\n    contentTypeRejected: number;\n    deadlineExceeded: boolean;'''
)

replace_once(
    public,
    'function parseRobots(text: string) {',
    '''type DetailedFetchResult =\n  | { ok: true; value: { url: string; text: string; contentType: string } }\n  | { ok: false; reason: string; status: number | null };\n\nasync function fetchTextDetailed(url: string, domain: string, maxRedirects = 3, deadlineAt: number | null = null): Promise<DetailedFetchResult> {\n  let current: URL;\n  try {\n    current = new URL(url);\n  } catch {\n    return { ok: false, reason: "INVALID_URL", status: null };\n  }\n\n  for (let redirect = 0; redirect <= maxRedirects; redirect++) {\n    if (!/^https?:$/.test(current.protocol) || !hostAllowed(current.hostname, domain) || isIP(current.hostname)) {\n      return { ok: false, reason: "HOST_OR_PROTOCOL_REJECTED", status: null };\n    }\n    const timeoutMs = deadlineTimeoutMs(deadlineAt);\n    if (timeoutMs <= 0) return { ok: false, reason: "DEADLINE_EXCEEDED", status: null };\n\n    let response: Response;\n    try {\n      response = await fetch(current, {\n        redirect: "manual",\n        headers: {\n          "user-agent": USER_AGENT,\n          accept: "text/html,text/plain;q=0.9,*/*;q=0.1"\n        },\n        signal: AbortSignal.timeout(timeoutMs)\n      });\n    } catch (error) {\n      const name = error instanceof Error ? error.name : "";\n      return {\n        ok: false,\n        reason: name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",\n        status: null\n      };\n    }\n\n    if ([301, 302, 303, 307, 308].includes(response.status)) {\n      const location = response.headers.get("location");\n      if (!location) return { ok: false, reason: "REDIRECT_WITHOUT_LOCATION", status: response.status };\n      let next: URL;\n      try {\n        next = new URL(location, current);\n      } catch {\n        return { ok: false, reason: "INVALID_REDIRECT", status: response.status };\n      }\n      if (!hostAllowed(next.hostname, domain) || isIP(next.hostname)) {\n        return { ok: false, reason: "OFF_DOMAIN_REDIRECT", status: response.status };\n      }\n      current = next;\n      continue;\n    }\n\n    if (!response.ok) {\n      const reason = response.status === 429\n        ? "HTTP_429"\n        : response.status >= 500\n          ? "HTTP_5XX"\n          : response.status >= 400\n            ? "HTTP_4XX"\n            : "HTTP_OTHER";\n      return { ok: false, reason, status: response.status };\n    }\n    const contentLength = Number(response.headers.get("content-length") || 0);\n    if (contentLength > MAX_PAGE_BYTES) return { ok: false, reason: "PAGE_TOO_LARGE", status: response.status };\n    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";\n    try {\n      const text = (await response.text()).slice(0, MAX_PAGE_BYTES);\n      return { ok: true, value: { url: current.toString(), text, contentType } };\n    } catch {\n      return { ok: false, reason: "BODY_READ_ERROR", status: response.status };\n    }\n  }\n  return { ok: false, reason: "REDIRECT_LIMIT", status: null };\n}\n\nfunction isLowValueResearchUrl(value: string) {\n  try {\n    const path = new URL(value).pathname.toLowerCase();\n    return /(?:\\/|^)(?:wp-admin|wp-json|feed|feeds|tag|tags|category|categories|search|login|signin|privacy|terms|cart|checkout)(?:\\/|$)/.test(path)\n      || /\\.(?:jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|docx?|xlsx?|pptx?)(?:$|\\?)/.test(path);\n  } catch {\n    return true;\n  }\n}\n\nfunction isHighValueResearchUrl(value: string) {\n  try {\n    const path = new URL(value).pathname.toLowerCase();\n    return /team|leadership|people|management|staff|executive|officer|owner|founder|about|contact|location|branch|profile|bio/.test(path);\n  } catch {\n    return false;\n  }\n}\n\nfunction parseRobots(text: string) {'''
)

replace_once(
    public,
    '''      fetchFailures: 0,\n      contentTypeRejected: 0,\n      deadlineExceeded: false\n    };\n    const enqueue = (url: string, sourceKind: "SITEMAP" | "INTERNAL") => {\n      if (queued.has(url)) return;\n      queued.add(url);\n      queue.push(url);\n      if (sourceKind === "SITEMAP") pageDiscovery.sitemapUrlsDiscovered++;\n      else pageDiscovery.internalUrlsDiscovered++;\n    };''',
    '''      fetchFailures: 0,\n      fetchFailureReasons: {} as Record<string, number>,\n      fetchFailureStatusCodes: {} as Record<string, number>,\n      fetchFailureSamples: [] as Array<{ url: string; reason: string; status: number | null }>,\n      lowValueUrlsSkipped: 0,\n      highValueUrlsPrioritized: 0,\n      contentTypeRejected: 0,\n      deadlineExceeded: false\n    };\n    const recordFetchFailure = (url: string, failure: { reason: string; status: number | null }) => {\n      pageDiscovery.fetchFailures++;\n      pageDiscovery.fetchFailureReasons[failure.reason] = (pageDiscovery.fetchFailureReasons[failure.reason] ?? 0) + 1;\n      if (failure.status !== null) {\n        const status = String(failure.status);\n        pageDiscovery.fetchFailureStatusCodes[status] = (pageDiscovery.fetchFailureStatusCodes[status] ?? 0) + 1;\n      }\n      if (pageDiscovery.fetchFailureSamples.length < 12) {\n        pageDiscovery.fetchFailureSamples.push({ url, reason: failure.reason, status: failure.status });\n      }\n      if (failure.reason === "DEADLINE_EXCEEDED") pageDiscovery.deadlineExceeded = true;\n    };\n    const enqueue = (url: string, sourceKind: "SITEMAP" | "INTERNAL") => {\n      if (queued.has(url)) return;\n      if (isLowValueResearchUrl(url)) {\n        pageDiscovery.lowValueUrlsSkipped++;\n        queued.add(url);\n        return;\n      }\n      queued.add(url);\n      if (isHighValueResearchUrl(url)) {\n        queue.unshift(url);\n        pageDiscovery.highValueUrlsPrioritized++;\n      } else {\n        queue.push(url);\n      }\n      if (sourceKind === "SITEMAP") pageDiscovery.sitemapUrlsDiscovered++;\n      else pageDiscovery.internalUrlsDiscovered++;\n    };'''
)

replace_once(
    public,
    '''        try {\n          const sitemap = await fetchText(sitemapUrl, domain, 3, deadlineAt);\n          if (!sitemap) {\n            pageDiscovery.fetchFailures++;\n            continue;\n          }\n          for (const discovered of extractSitemapLinks(sitemap.text, domain).slice(0, 60)) enqueue(discovered, "SITEMAP");\n        } catch {\n          pageDiscovery.fetchFailures++;\n        }''',
    '''        const sitemapFetch = await fetchTextDetailed(sitemapUrl, domain, 3, deadlineAt);\n        if (!sitemapFetch.ok) {\n          recordFetchFailure(sitemapUrl, sitemapFetch);\n          continue;\n        }\n        for (const discovered of extractSitemapLinks(sitemapFetch.value.text, domain).slice(0, 60)) enqueue(discovered, "SITEMAP");'''
)

replace_once(
    public,
    '''      let fetched: { url: string; text: string; contentType: string } | null = null;\n      try {\n        fetched = await fetchText(next, domain, 3, deadlineAt);\n      } catch {\n        pageDiscovery.fetchFailures++;\n        continue;\n      }\n      if (!fetched) {\n        pageDiscovery.fetchFailures++;\n        continue;\n      }''',
    '''      const fetchResult = await fetchTextDetailed(next, domain, 3, deadlineAt);\n      if (!fetchResult.ok) {\n        recordFetchFailure(next, fetchResult);\n        continue;\n      }\n      const fetched = fetchResult.value;'''
)

replace_once(
    public,
    'function candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[], emailPatternObservations: PublicEmailPatternObservation[] = [], targetingContext: ContactTargetingContext = {}): PublicResearchCandidate | null {',
    '''function looksLikeExternalOrganizationLabel(value: string, domain: string) {\n  const text = decodeHtml(value).replace(/\\s+/g, " ").trim();\n  if (!text || text.length > 100 || looksLikePersonName(text)) return false;\n  const normalized = normalizeTitle(text);\n  const brand = normalizeNameToken(normalizeDomain(domain).split(".")[0] ?? "");\n  if (!normalized || (brand && normalizeNameToken(normalized).includes(brand))) return false;\n  return /\\b(?:inc|llc|company|corp|corporation|group|shop|bakery|university|college|school|stadium|restaurant|customs|services|solutions|systems|mechanical|plumbing|roofing|heating|cooling|hvac|landscape|landscaping|cleaning|partners|associates|agency|hospital|clinic|hotel|club|church|bank|supply)\\b/i.test(normalized);\n}\n\nfunction candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[], emailPatternObservations: PublicEmailPatternObservation[] = [], targetingContext: ContactTargetingContext = {}): PublicResearchCandidate | null {'''
)

replace_once(
    public,
    '''      const name = sameLineName ?? adjacentName;\n      if (!name) continue;\n\n      const proximity: "SAME_LINE" | "ADJACENT_LINE" = sameLineName ? "SAME_LINE" : "ADJACENT_LINE";''',
    '''      const name = sameLineName ?? adjacentName;\n      if (!name) continue;\n      if (sameLineName && looksLikeExternalOrganizationLabel(lines[index + 1] ?? "", domain)) continue;\n\n      const proximity: "SAME_LINE" | "ADJACENT_LINE" = sameLineName ? "SAME_LINE" : "ADJACENT_LINE";'''
)

replace_once(
    public,
    '''      if (corroboratingPages >= 2) decisionMakerConfidence += 7;\n      if (nameEmail) decisionMakerConfidence += 10;\n      decisionMakerConfidence = Math.min(99, decisionMakerConfidence);''',
    '''      if (corroboratingPages >= 2) decisionMakerConfidence += 7;\n      if (nameEmail) decisionMakerConfidence += 10;\n      if (!leadershipPage && !nameEmail) decisionMakerConfidence = Math.min(decisionMakerConfidence, 79);\n      decisionMakerConfidence = Math.min(99, decisionMakerConfidence);'''
)

replace_count(
    public,
    '        inferredEmailCandidates: publishedEmail ? [] : inferredEmails(name, domain),',
    '        inferredEmailCandidates: publishedEmail || decisionMakerConfidence < HIGH_CONFIDENCE_THRESHOLD ? [] : inferredEmails(name, domain),',
    2
)

package = "package.json"
replace_once(
    package,
    '"arborlineResearchVersion": "identity-affiliation-compound-surname-v3"',
    '"arborlineResearchVersion": "crawler-diagnostics-identity-qc-v4"'
)

workers = "lib/connect-deep-research-workers.ts"
replace_once(
    workers,
    '''    evidence: candidate.evidence,\n    robots_respected: result.robotsRespected,\n    error: result.error ?? null''',
    '''    evidence: candidate.evidence,\n    robots_respected: result.robotsRespected,\n    diagnostics: result.diagnostics ?? null,\n    error: result.error ?? null'''
)
replace_once(
    workers,
    '''    pages_checked: result?.pagesChecked.slice(0, 20) ?? [],\n    evidence: candidate?.evidence ?? [],\n    manual_identity_preserved: manualIdentityLocked,''',
    '''    pages_checked: result?.pagesChecked.slice(0, 20) ?? [],\n    evidence: candidate?.evidence ?? [],\n    diagnostics: result?.diagnostics ?? null,\n    manual_identity_preserved: manualIdentityLocked,'''
)
replace_once(
    workers,
    '''    shared_inbox_candidates: result?.sharedInboxCandidates?.slice(0, 10) ?? [],\n    evidence: candidate?.evidence ?? []\n  };''',
    '''    shared_inbox_candidates: result?.sharedInboxCandidates?.slice(0, 10) ?? [],\n    evidence: candidate?.evidence ?? [],\n    diagnostics: result?.diagnostics ?? null\n  };'''
)
replace_once(
    workers,
    'async function candidateRows(clientId: string, mode: "dm" | "email", limit: number) {',
    'async function candidateRows(clientId: string, mode: "dm" | "email", limit: number, prospectId: string | null = null) {'
)
replace_once(
    workers,
    '''     WHERE p.client_id=$1\n       AND p.segment_id IS NOT NULL''',
    '''     WHERE p.client_id=$1\n       AND ($5::text IS NULL OR p.id::text=$5::text)\n       AND p.segment_id IS NOT NULL'''
)
replace_once(
    workers,
    '    [clientId, mode, deepKey, safeLimit]\n  );',
    '    [clientId, mode, deepKey, safeLimit, prospectId]\n  );'
)
replace_once(
    workers,
    'export async function runDeepDecisionMakerWorker(clientId: string, limit = 2) {\n  const rows = await candidateRows(clientId, "dm", limit);',
    'export async function runDeepDecisionMakerWorker(clientId: string, limit = 2, prospectId: string | null = null) {\n  const rows = await candidateRows(clientId, "dm", limit, prospectId);'
)

route = "app/api/cron/connect-deep-research/route.ts"
replace_once(
    route,
    '? await runDeepDecisionMakerWorker(clientId, boundedLimit(url.searchParams.get("limit"), 2, 6))',
    '? await runDeepDecisionMakerWorker(clientId, boundedLimit(url.searchParams.get("limit"), 2, 6), url.searchParams.get("prospectId"))'
)

print("Applied crawler diagnostics, identity QC, and targeted benchmark support.")
