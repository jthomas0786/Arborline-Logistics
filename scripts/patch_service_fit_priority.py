from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing marker: {label}")
    return text.replace(old, new, 1)


research_path = Path("lib/connect-public-research.ts")
text = research_path.read_text()
text = replace_once(
    text,
    "     ORDER BY qualification_score DESC NULLS LAST,created_at ASC",
    """     ORDER BY CASE
                WHEN source='ARBORLINE_DISCOVERY'
                 AND coalesce(source_metadata->'service_fit'->>'status','')=''
                THEN 0 ELSE 1
              END ASC,
              qualification_score DESC NULLS LAST,created_at ASC""",
    "research service-fit priority",
)
research_path.write_text(text)


route_path = Path("app/api/cron/connect-research/route.ts")
text = route_path.read_text()
old_select = '''  const { rows } = await pool.query(
    `SELECT s.id,s.name,s.slug,
            count(p.id)::int AS backlog
     FROM connect_prospect_segments s'''
new_select = '''  const { rows } = await pool.query(
    `SELECT s.id,s.name,s.slug,
            count(p.id)::int AS backlog,
            count(p.id) FILTER (
              WHERE p.source='ARBORLINE_DISCOVERY'
                AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
            )::int AS service_fit_backlog
     FROM connect_prospect_segments s'''
text = replace_once(text, old_select, new_select, "default segment backlog select")
text = replace_once(
    text,
    "     ORDER BY count(p.id) DESC,s.slug ASC",
    """     ORDER BY count(p.id) FILTER (
                WHERE p.source='ARBORLINE_DISCOVERY'
                  AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
              ) DESC,
              count(p.id) DESC,s.slug ASC""",
    "segment service-fit priority order",
)
route_path.write_text(text)
