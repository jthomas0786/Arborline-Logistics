from pathlib import Path
import re

patch_path = Path('.github/scripts/patch_public_research_diagnostics_v4.py')
text = patch_path.read_text()
pattern = re.compile(
    r"\nreplace_once\(\n    workers,\n    'async function candidateRows\(clientId: string, mode: \\\"dm\\\" \| \\\"email\\\", limit: number\) \{',.*?\n\)\n\nroute = \\\"app/api/cron/connect-deep-research/route\.ts\\\"\nreplace_once\(.*?\n\)\n\nprint\(\\\"Applied crawler diagnostics, identity QC, and targeted benchmark support\.\\\"\)\n?",
    re.S,
)
replacement = '\nprint("Applied crawler diagnostics and identity QC.")\n'
updated, count = pattern.subn(replacement, text, count=1)
if count != 1:
    if 'Applied crawler diagnostics and identity QC.' in text and 'prospectId' not in text:
        print('benchmark hook already separated')
        raise SystemExit(0)
    raise SystemExit(f'expected one targeted benchmark patch section, found {count}')
patch_path.write_text(updated)

workflow_path = Path('.github/workflows/one-time-public-research-diagnostics-v4.yml')
workflow = workflow_path.read_text()
workflow = workflow.replace("          grep -q 'prospectId' app/api/cron/connect-deep-research/route.ts\n", '')
workflow = workflow.replace(' lib/connect-deep-research-workers.ts app/api/cron/connect-deep-research/route.ts package.json', ' lib/connect-deep-research-workers.ts package.json')
workflow_path.write_text(workflow)
print('separated targeted benchmark hook from diagnostics patch')
