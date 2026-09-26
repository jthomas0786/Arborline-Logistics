from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    if new in text:
        print(f"already applied: {label}")
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    p.write_text(text.replace(old, new, 1))

workers = "lib/connect-deep-research-workers.ts"
route = "app/api/cron/connect-deep-research/route.ts"
workflow = ".github/workflows/connect-deep-research.yml"

replace_once(
    workers,
    'async function candidateRows(clientId: string, mode: "dm" | "email", limit: number) {',
    'async function candidateRows(clientId: string, mode: "dm" | "email", limit: number, prospectId: string | null = null) {',
    'candidateRows prospect filter signature'
)
replace_once(
    workers,
    '''     WHERE p.client_id=$1\n       AND p.segment_id IS NOT NULL\n       AND p.domain IS NOT NULL\n       AND (\n         (\n           $2::text='dm'\n           AND nullif(p.source_metadata->'decision_maker_refresh'->>'requested_at','') IS NOT NULL''',
    '''     WHERE p.client_id=$1\n       AND ($5::text IS NULL OR p.id::text=$5::text)\n       AND p.segment_id IS NOT NULL\n       AND p.domain IS NOT NULL\n       AND (\n         (\n           $2::text='dm'\n           AND nullif(p.source_metadata->'decision_maker_refresh'->>'requested_at','') IS NOT NULL''',
    'candidateRows prospect WHERE filter'
)
replace_once(
    workers,
    '    [clientId, mode, deepKey, safeLimit]\n  );',
    '    [clientId, mode, deepKey, safeLimit, prospectId]\n  );',
    'candidateRows prospect bind'
)
replace_once(
    workers,
    'export async function runDeepDecisionMakerWorker(clientId: string, limit = 2) {\n  const rows = await candidateRows(clientId, "dm", limit);',
    'export async function runDeepDecisionMakerWorker(clientId: string, limit = 2, prospectId: string | null = null) {\n  const rows = await candidateRows(clientId, "dm", limit, prospectId);',
    'decision maker worker prospect filter'
)
replace_once(
    route,
    '? await runDeepDecisionMakerWorker(clientId, boundedLimit(url.searchParams.get("limit"), 2, 6))',
    '? await runDeepDecisionMakerWorker(clientId, boundedLimit(url.searchParams.get("limit"), 2, 6), url.searchParams.get("prospectId"))',
    'route prospect parameter'
)

replace_once(
    workflow,
    '      - ".github/workflows/connect-deep-research.yml"',
    '      - ".github/workflows/connect-deep-research.yml"\n      - ".github/benchmark-prospect-id.txt"',
    'benchmark file trigger'
)
replace_once(
    workflow,
    "    if: ${{ github.event_name != 'push' || github.event.head_commit.message != 'Run native correction pass' }}\n    name: Resolve strongest decision makers",
    "    if: ${{ github.event_name != 'push' || (github.event.head_commit.message != 'Run native correction pass' && !startsWith(github.event.head_commit.message, 'Benchmark prospect ')) }}\n    name: Resolve strongest decision makers",
    'decision maker benchmark exclusion'
)
replace_once(
    workflow,
    "    if: ${{ github.event_name != 'push' || github.event.head_commit.message != 'Run native correction pass' }}\n    name: Hunt published direct emails",
    "    if: ${{ github.event_name != 'push' || (github.event.head_commit.message != 'Run native correction pass' && !startsWith(github.event.head_commit.message, 'Benchmark prospect ')) }}\n    name: Hunt published direct emails",
    'published email benchmark exclusion'
)
replace_once(
    workflow,
    '''  native-candidates:\n    name: Build verification-ready native candidates\n    needs: [decision-maker, published-email]\n    if: ${{ always() }}''',
    '''  native-candidates:\n    name: Build verification-ready native candidates\n    needs: [decision-maker, published-email]\n    if: ${{ always() && (github.event_name != 'push' || !startsWith(github.event.head_commit.message, 'Benchmark prospect ')) }}''',
    'native candidate benchmark exclusion'
)
replace_once(
    workflow,
    '\n# Validation trigger: strict public-person pattern native-only pass.',
    '''\n  benchmark-prospect:\n    if: ${{ github.event_name == 'push' && startsWith(github.event.head_commit.message, 'Benchmark prospect ') }}\n    name: Targeted protected research benchmark\n    runs-on: ubuntu-latest\n    timeout-minutes: 8\n    steps:\n      - uses: actions/checkout@v4\n      - name: Run targeted decision-maker benchmark\n        shell: bash\n        run: |\n          set -euo pipefail\n          prospect_id="$(tr -d '\\r\\n ' < .github/benchmark-prospect-id.txt)"\n          [[ "${prospect_id}" =~ ^[0-9a-fA-F-]{36}$ ]]\n          endpoint="https://www.arborlineconnect.com/api/cron/connect-deep-research?mode=decision-maker&limit=1&prospectId=${prospect_id}"\n          separator="&"\n          if [[ "${ACTIONS_ID_TOKEN_REQUEST_URL}" != *"?"* ]]; then separator="?"; fi\n          oidc_response="$(curl --fail --silent --show-error \\\n            -H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \\\n            "${ACTIONS_ID_TOKEN_REQUEST_URL}${separator}audience=arborline-connect-deep-research")"\n          oidc_token="$(printf '%s' "${oidc_response}" | jq -r '.value')"\n          response="$(curl --fail-with-body --silent --show-error --max-time 300 \\\n            -H "Authorization: Bearer ${oidc_token}" \\\n            -H "User-Agent: ArborLine-Targeted-Benchmark/1.0" \\\n            "${endpoint}")"\n          printf '%s\\n' "${response}" | jq .\n          printf '%s' "${response}" | jq -e '.ok == true and .result.attempted == 1 and .safety.providerCallsMade == 0 and .safety.messagesSent == 0 and .safety.outreachApprovalsCreated == 0' >/dev/null\n\n# Validation trigger: strict public-person pattern native-only pass.''',
    'benchmark job'
)

print('Applied protected targeted benchmark hook.')
