DELETE FROM public.connect_email_verification_cache v
USING public.connect_contact_candidates cc, public.connect_prospects p, public.connect_clients c
WHERE cc.prospect_id=p.id
  AND cc.client_id=c.id
  AND v.client_id=cc.client_id
  AND lower(v.email)=lower(cc.email)
  AND lower(c.company_name)=lower('ArborLine Connect')
  AND lower(p.domain)='roberthalf.com'
  AND lower(coalesce(cc.contact_name,''))=lower('Marc H. Morial');

DELETE FROM public.connect_contact_candidates cc
USING public.connect_prospects p, public.connect_clients c
WHERE cc.prospect_id=p.id
  AND cc.client_id=c.id
  AND lower(c.company_name)=lower('ArborLine Connect')
  AND lower(p.domain)='roberthalf.com'
  AND lower(coalesce(cc.contact_name,''))=lower('Marc H. Morial');

UPDATE public.connect_prospects p
SET contact_name='M. Keith Waddell',
    contact_title='Vice Chairman, President and Chief Executive Officer',
    contact_email=NULL,
    enrichment_status='PENDING',
    outreach_status='NOT_READY',
    source_metadata=coalesce(p.source_metadata,'{}'::jsonb)
      || jsonb_build_object(
        'identity_correction', jsonb_build_object(
          'corrected_at', now(),
          'reason', 'Previous parser attached an outside-organization President/CEO title to a Robert Half board member.',
          'previous_name', 'Marc H. Morial',
          'previous_title', 'President',
          'corrected_name', 'M. Keith Waddell',
          'corrected_title', 'Vice Chairman, President and Chief Executive Officer',
          'source_url', 'https://www.roberthalf.com/us/en/about/leadership',
          'source', 'ROBERT_HALF_OFFICIAL_LEADERSHIP'
        ),
        'public_research', coalesce(p.source_metadata->'public_research','{}'::jsonb)
          || jsonb_build_object(
            'decision_maker_name', 'M. Keith Waddell',
            'decision_maker_title', 'Vice Chairman, President and Chief Executive Officer',
            'decision_maker_confidence', 99,
            'decision_maker_confidence_grade', 'HIGH',
            'published_email', NULL,
            'email_status', 'NONE',
            'email_confidence', 0,
            'inferred_email_candidates', '[]'::jsonb,
            'source_url', 'https://www.roberthalf.com/us/en/about/leadership',
            'evidence', jsonb_build_array(
              'Robert Half official leadership identifies M. Keith Waddell as Vice Chairman, President and Chief Executive Officer.',
              'Marc H. Morial is listed as a board member whose President and CEO title belongs to the National Urban League, not Robert Half.'
            )
          ),
        'native_contact_enrichment', jsonb_build_object(
          'checked_at', now(),
          'engine_version', 1,
          'mailbox_verified', false,
          'best_candidate_email', NULL,
          'best_candidate_status', 'NONE',
          'best_candidate_confidence', 0,
          'provider_fallback_recommended', false,
          'paused_reason', 'Await compound/initial-name source deployment before regenerating candidates.'
        )
      ),
    updated_at=now()
FROM public.connect_clients c
WHERE p.client_id=c.id
  AND lower(c.company_name)=lower('ArborLine Connect')
  AND lower(p.domain)='roberthalf.com'
  AND lower(coalesce(p.contact_name,''))=lower('Marc H. Morial');
