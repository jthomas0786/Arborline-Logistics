from pathlib import Path

path = Path("lib/connect-public-research.ts")
text = path.read_text()

if 'from "@/lib/connect-research-route-memory"' in text:
    print("connect route memory already integrated")
    raise SystemExit(0)


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    'import { getPool } from "@/lib/db";\n',
    'import { getPool } from "@/lib/db";\nimport {\n  buildAdaptiveResearchSeeds,\n  loadConnectResearchRouteMemory,\n  persistConnectResearchRouteOutcomes,\n  shouldSkipRememberedDeadRoute,\n  type ConnectResearchRouteOutcome\n} from "@/lib/connect-research-route-memory";\n',
    "route memory import",
)

replace_once(
    '    seededUrls: number;\n    sitemapUrlsDiscovered: number;',
    '    seededUrls: number;\n    knownDeadUrlsSkipped: number;\n    rememberedGoodUrlsPrioritized: number;\n    routeMemoryWrites: number;\n    sitemapUrlsDiscovered: number;',
    "diagnostic fields",
)

old_queue = '''    const queue = [
      `https://${domain}/`,
      `https://${domain}/about`,
      `https://${domain}/about-us`,
      `https://${domain}/team`,
      `https://${domain}/our-team`,
      `https://${domain}/leadership`,
      `https://${domain}/contact`,
      ...(options.expanded ? [
        `https://${domain}/staff`,
        `https://${domain}/people`,
        `https://${domain}/who-we-are`,
        `https://${domain}/locations`
      ] : [])
    ];
    const queued = new Set(queue);
'''
new_queue = '''    const routeMemory = await loadConnectResearchRouteMemory(domain);
    const baseSeedPaths = [
      "/",
      "/about",
      "/about-us",
      "/team",
      "/our-team",
      "/leadership",
      "/contact",
      ...(options.expanded ? ["/staff", "/people", "/who-we-are", "/locations"] : [])
    ];
    const adaptiveSeeds = buildAdaptiveResearchSeeds(domain, baseSeedPaths, routeMemory);
    const queue = [...adaptiveSeeds.urls];
    const queued = new Set(queue);
'''
replace_once(old_queue, new_queue, "adaptive seed queue")

replace_once(
    '      seededUrls: queue.length,\n      sitemapUrlsDiscovered: 0,',
    '      seededUrls: queue.length,\n      knownDeadUrlsSkipped: adaptiveSeeds.skippedKnownDead,\n      rememberedGoodUrlsPrioritized: adaptiveSeeds.rememberedGoodPrioritized,\n      routeMemoryWrites: 0,\n      sitemapUrlsDiscovered: 0,',
    "diagnostic initialization",
)

replace_once(
    '''    const enqueue = (url: string, sourceKind: "SITEMAP" | "INTERNAL") => {
      if (queued.has(url)) return;
      if (isLowValueResearchUrl(url)) { pageDiscovery.lowValueUrlsSkipped++; queued.add(url); return; }
''',
    '''    const enqueue = (url: string, sourceKind: "SITEMAP" | "INTERNAL") => {
      if (queued.has(url)) return;
      if (shouldSkipRememberedDeadRoute(url, routeMemory)) {
        pageDiscovery.knownDeadUrlsSkipped++;
        queued.add(url);
        return;
      }
      if (isLowValueResearchUrl(url)) { pageDiscovery.lowValueUrlsSkipped++; queued.add(url); return; }
''',
    "discovered-route dead memory gate",
)

replace_once(
    '''    const visited = new Set<string>();
    const pages: PageSnapshot[] = [];
    const pageLimit = options.expanded ? 16 : MAX_PAGES;
''',
    '''    const visited = new Set<string>();
    const pages: PageSnapshot[] = [];
    const routeOutcomes: ConnectResearchRouteOutcome[] = [];
    const pageLimit = options.expanded ? 16 : MAX_PAGES;
''',
    "route outcome accumulator",
)

replace_once(
    '      const fetchResult = await fetchTextDetailed(next, domain, 3, deadlineAt);\n      if (!fetchResult.ok) { recordFetchFailure(next, fetchResult); continue; }\n      const fetched = fetchResult.value;',
    '      const fetchResult = await fetchTextDetailed(next, domain, 3, deadlineAt);\n      if (!fetchResult.ok) {\n        recordFetchFailure(next, fetchResult);\n        routeOutcomes.push({ url: next, ok: false, status: fetchResult.status });\n        continue;\n      }\n      routeOutcomes.push({ url: next, ok: true, status: 200 });\n      const fetched = fetchResult.value;',
    "fetch outcome capture",
)

replace_once(
    '    const profilePages: PageSnapshot[] = [];\n',
    '    pageDiscovery.routeMemoryWrites = await persistConnectResearchRouteOutcomes(domain, routeOutcomes);\n\n    const profilePages: PageSnapshot[] = [];\n',
    "route outcome persistence",
)

path.write_text(text)
print("integrated persistent adaptive route memory into connect-public-research.ts")
