from pathlib import Path

patch_path = Path('.github/scripts/patch_public_research_diagnostics_v4.py')
text = patch_path.read_text()
marker = "replace_once(\n    workers,\n    'async function candidateRows(clientId: string, mode: \"dm\" | \"email\", limit: number) {',"
if marker in text:
    text = text[:text.index(marker)] + 'print("Applied crawler diagnostics and identity QC.")\n'
elif 'Applied crawler diagnostics and identity QC.' not in text:
    raise SystemExit('candidateRows marker not found')
patch_path.write_text(text)

workflow_path = Path('.github/workflows/one-time-public-research-diagnostics-v4.yml')
workflow = workflow_path.read_text()
workflow = workflow.replace("          grep -q 'prospectId' app/api/cron/connect-deep-research/route.ts\n", '')
workflow = workflow.replace(' lib/connect-deep-research-workers.ts app/api/cron/connect-deep-research/route.ts package.json', ' lib/connect-deep-research-workers.ts package.json')
workflow_path.write_text(workflow)
print('Separated benchmark hook from crawler diagnostics patch.')
