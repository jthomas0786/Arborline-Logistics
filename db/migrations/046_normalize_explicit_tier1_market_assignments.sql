-- Repair and normalize public Overture prospects created by the explicit Tier-1
-- expansion worker. The discovery_region slug is authoritative for these runs;
-- it must win over the generic state fallback assignment.
--
-- This migration only changes research-market organization. It does not enrich
-- contacts, enable provider spend, create approvals, queue outreach, or send mail.

UPDATE connect_prospects p
SET market_id=m.id,
    source_metadata=coalesce(p.source_metadata,'{}'::jsonb) || jsonb_build_object(
      'research_market_assignment',jsonb_build_object(
        'market_id',m.id,
        'market_slug',m.slug,
        'market_name',m.name,
        'market_type','METRO',
        'assignment_method','EXPLICIT_TIER1_DISCOVERY',
        'assigned_at',now()
      )
    ),
    updated_at=now()
FROM connect_research_markets m
WHERE p.source='ARBORLINE_DISCOVERY'
  AND upper(coalesce(p.source_metadata->>'discovery_provider',''))='OVERTURE_MAPS'
  AND m.market_type='METRO'
  AND m.tier=1
  AND m.status='ACTIVE'
  AND m.slug=lower(coalesce(p.source_metadata->>'discovery_region',''))
  AND p.market_id IS DISTINCT FROM m.id;
