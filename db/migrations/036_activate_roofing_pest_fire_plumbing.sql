with arborline as (
  select id as client_id
  from connect_clients
  where lower(company_name)=lower('ArborLine Connect')
  order by created_at asc
  limit 1
), segments as (
  select * from (values
    (
      'commercial-roofing',
      'Commercial Roofing',
      'Commercial Roofing',
      array['Commercial Roofing','Roofing Contractors','Roofing Services','Industrial Roofing','Roof Maintenance']::text[],
      array['residential-only roofing','roofing supply','roofing materials supplier','building materials','roofing manufacturer','home improvement only']::text[],
      'Active ArborLine Commercial Roofing growth segment. Target commercial and mixed commercial/residential roofing contractors in Illinois, Indiana, and Wisconsin with 5–500 employees. Exclude clearly residential-only roofers, suppliers, manufacturers, and building-material businesses. Human approval remains required before outbound email is queued or sent.'
    ),
    (
      'pest-control',
      'Pest Control',
      'Pest Control',
      array['Commercial Pest Control','Pest Management','Exterminating Services','Pest Control Services','Termite & Pest Control']::text[],
      array['pest control supply','pest control products','wildlife removal only','lawn treatment only','residential-only pest control']::text[],
      'Active ArborLine Pest Control growth segment. Target pest-management companies in Illinois, Indiana, and Wisconsin with 5–500 employees, prioritizing firms that can serve commercial properties and recurring service accounts. Exclude product suppliers and clearly non-commercial specialty-only operators. Human approval remains required before outbound email is queued or sent.'
    ),
    (
      'fire-protection',
      'Fire Protection',
      'Fire Protection',
      array['Fire Protection Services','Fire Sprinkler Services','Fire Alarm Services','Fire Extinguisher Services','Life Safety Services']::text[],
      array['fire department','fire station','fire equipment manufacturer','fire truck dealer','public safety agency']::text[],
      'Active ArborLine Fire Protection growth segment. Target private fire-protection and life-safety service contractors in Illinois, Indiana, and Wisconsin with 5–500 employees, including sprinkler, alarm, extinguisher, inspection, and recurring compliance-service firms. Exclude public fire departments, stations, agencies, manufacturers, and apparatus dealers. Human approval remains required before outbound email is queued or sent.'
    ),
    (
      'commercial-plumbing',
      'Commercial Plumbing',
      'Commercial Plumbing',
      array['Commercial Plumbing','Plumbing Contractors','Plumbing Services','Industrial Plumbing','Mechanical Plumbing']::text[],
      array['plumbing supply','plumbing supplies','hardware store','fixture showroom','plumbing manufacturer','residential handyman only']::text[],
      'Active ArborLine Commercial Plumbing growth segment. Target commercial and mixed-service plumbing contractors in Illinois, Indiana, and Wisconsin with 5–500 employees. Exclude supply houses, hardware retailers, fixture showrooms, manufacturers, and clearly residential-handyman-only businesses. Human approval remains required before outbound email is queued or sent.'
    )
  ) as v(slug,name,service_vertical,target_industries,exclusions,qualification_notes)
)
insert into connect_prospect_segments (
  client_id,slug,name,service_vertical,status,target_industries,target_geographies,
  min_employees,max_employees,facility_types,decision_maker_titles,buying_signals,
  exclusions,qualification_notes,minimum_score,approved_at,updated_at
)
select
  a.client_id,s.slug,s.name,s.service_vertical,'ACTIVE',s.target_industries,
  array['Illinois','Indiana','Wisconsin']::text[],5,500,array[]::text[],
  array[
    'Owner','President','CEO','Founder','General Manager','Managing Partner','COO','Chief Operating Officer',
    'VP Sales','Vice President of Sales','Sales Director','Sales Manager','Director of Business Development',
    'Business Development Manager','Director of Operations'
  ]::text[],
  array[]::text[],s.exclusions,s.qualification_notes,70,now(),now()
from arborline a
cross join segments s
on conflict (client_id,slug) do update set
  name=excluded.name,
  service_vertical=excluded.service_vertical,
  status='ACTIVE',
  target_industries=excluded.target_industries,
  target_geographies=excluded.target_geographies,
  min_employees=excluded.min_employees,
  max_employees=excluded.max_employees,
  facility_types=excluded.facility_types,
  decision_maker_titles=excluded.decision_maker_titles,
  buying_signals=excluded.buying_signals,
  exclusions=excluded.exclusions,
  qualification_notes=excluded.qualification_notes,
  minimum_score=excluded.minimum_score,
  approved_at=coalesce(connect_prospect_segments.approved_at,now()),
  updated_at=now();
