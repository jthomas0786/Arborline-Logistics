DO $$
DECLARE org_id uuid; carrier_id uuid; driver_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE legal_name='Arborline Demo Carrier One') THEN
    INSERT INTO organizations(type,legal_name) VALUES ('CARRIER','Arborline Demo Carrier One') RETURNING id INTO org_id;
    INSERT INTO carriers(organization_id,usdot_number,mc_number,authority_status,insurance_status,onboarding_status,fraud_score,performance_score,verified_at,last_verified_at,verification_expires_at,verified_legal_name,legal_name_verified,dispatch_phone)
    VALUES(org_id,'9000001','1900001','ACTIVE','VALID','VERIFIED',8,96,now(),now(),now()+interval '24 hours','Arborline Demo Carrier One',true,'555-0101') RETURNING id INTO carrier_id;
    INSERT INTO carrier_equipment_profiles(carrier_id,equipment_type) VALUES(carrier_id,'DRY_VAN');
    INSERT INTO drivers(carrier_id,name,phone) VALUES(carrier_id,'Demo Driver One','555-0101') RETURNING id INTO driver_id;
    INSERT INTO trucks(carrier_id,driver_id,unit_number,equipment_type,current_location,available_at,status,location_updated_at) VALUES(carrier_id,driver_id,'D-101','DRY_VAN',ST_SetSRID(ST_MakePoint(-87.70,41.91),4326)::geography,now(),'AVAILABLE',now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE legal_name='Arborline Demo Carrier Two') THEN
    INSERT INTO organizations(type,legal_name) VALUES ('CARRIER','Arborline Demo Carrier Two') RETURNING id INTO org_id;
    INSERT INTO carriers(organization_id,usdot_number,mc_number,authority_status,insurance_status,onboarding_status,fraud_score,performance_score,verified_at,last_verified_at,verification_expires_at,verified_legal_name,legal_name_verified,dispatch_phone)
    VALUES(org_id,'9000002','1900002','ACTIVE','VALID','VERIFIED',12,91,now(),now(),now()+interval '24 hours','Arborline Demo Carrier Two',true,'555-0102') RETURNING id INTO carrier_id;
    INSERT INTO carrier_equipment_profiles(carrier_id,equipment_type) VALUES(carrier_id,'DRY_VAN');
    INSERT INTO drivers(carrier_id,name,phone) VALUES(carrier_id,'Demo Driver Two','555-0102') RETURNING id INTO driver_id;
    INSERT INTO trucks(carrier_id,driver_id,unit_number,equipment_type,current_location,available_at,status,location_updated_at) VALUES(carrier_id,driver_id,'D-102','DRY_VAN',ST_SetSRID(ST_MakePoint(-87.93,41.75),4326)::geography,now(),'AVAILABLE',now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE legal_name='Arborline Demo Carrier Three') THEN
    INSERT INTO organizations(type,legal_name) VALUES ('CARRIER','Arborline Demo Carrier Three') RETURNING id INTO org_id;
    INSERT INTO carriers(organization_id,usdot_number,mc_number,authority_status,insurance_status,onboarding_status,fraud_score,performance_score,verified_at,last_verified_at,verification_expires_at,verified_legal_name,legal_name_verified,dispatch_phone)
    VALUES(org_id,'9000003','1900003','ACTIVE','VALID','VERIFIED',4,89,now(),now(),now()+interval '24 hours','Arborline Demo Carrier Three',true,'555-0103') RETURNING id INTO carrier_id;
    INSERT INTO carrier_equipment_profiles(carrier_id,equipment_type) VALUES(carrier_id,'DRY_VAN');
    INSERT INTO drivers(carrier_id,name,phone) VALUES(carrier_id,'Demo Driver Three','555-0103') RETURNING id INTO driver_id;
    INSERT INTO trucks(carrier_id,driver_id,unit_number,equipment_type,current_location,available_at,status,location_updated_at) VALUES(carrier_id,driver_id,'D-103','DRY_VAN',ST_SetSRID(ST_MakePoint(-88.08,41.88),4326)::geography,now(),'AVAILABLE',now());
  END IF;
END $$;
