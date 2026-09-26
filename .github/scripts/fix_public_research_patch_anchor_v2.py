from pathlib import Path

p = Path('.github/scripts/patch_public_research_diagnostics_v4.py')
text = p.read_text()
old = """replace_once(\n    workers,\n    '''     JOIN connect_prospect_segments s\\n       ON s.id=p.segment_id AND s.client_id=p.client_id AND s.status IN ('APPROVED','ACTIVE')\\n     WHERE p.client_id=$1\\n       AND p.segment_id IS NOT NULL''',\n    '''     JOIN connect_prospect_segments s\\n       ON s.id=p.segment_id AND s.client_id=p.client_id AND s.status IN ('APPROVED','ACTIVE')\\n     WHERE p.client_id=$1\\n       AND ($5::text IS NULL OR p.id::text=$5::text)\\n       AND p.segment_id IS NOT NULL'''\n)"""
new = """replace_once(\n    workers,\n    '''     JOIN connect_prospect_segments s\\n       ON s.id=p.segment_id AND s.client_id=p.client_id AND s.status IN ('APPROVED','ACTIVE')\\n     WHERE p.client_id=$1\\n       AND p.segment_id IS NOT NULL\\n       AND p.domain IS NOT NULL\\n       AND (\\n         (\\n           $2::text='dm' ''',\n    '''     JOIN connect_prospect_segments s\\n       ON s.id=p.segment_id AND s.client_id=p.client_id AND s.status IN ('APPROVED','ACTIVE')\\n     WHERE p.client_id=$1\\n       AND ($5::text IS NULL OR p.id::text=$5::text)\\n       AND p.segment_id IS NOT NULL\\n       AND p.domain IS NOT NULL\\n       AND (\\n         (\\n           $2::text='dm' '''\n)"""
if old not in text:
    if new in text:
        print('v2 anchor already fixed')
        raise SystemExit(0)
    raise SystemExit('v2 target patch block not found')
p.write_text(text.replace(old, new, 1))
print('fixed candidateRows patch anchor v2')
