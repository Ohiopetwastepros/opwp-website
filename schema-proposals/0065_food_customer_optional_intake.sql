-- PROPOSAL ONLY: separate production database authorization is required.
-- Core customer identity stays in dog_food_customers. Preserve every stored
-- preference, consent timestamp, account, order and payment without inventing data.
CREATE TABLE dog_food_customer_profiles_next (
  customer_id TEXT PRIMARY KEY REFERENCES dog_food_customers(id),
  dog_count INTEGER CHECK(dog_count IS NULL OR dog_count BETWEEN 1 AND 99),
  service_frequency TEXT CHECK(service_frequency IS NULL OR service_frequency IN('as_needed','weekly','biweekly','monthly')),
  preferred_fulfillment TEXT NOT NULL CHECK(preferred_fulfillment IN('pickup','delivery')),
  notes TEXT NOT NULL DEFAULT '', sms_consent_at TEXT, sms_consent_phone TEXT,
  revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO dog_food_customer_profiles_next(customer_id,dog_count,service_frequency,preferred_fulfillment,notes,sms_consent_at,sms_consent_phone,revision,created_by,updated_by,created_at,updated_at)
  SELECT p.customer_id,p.dog_count,p.service_frequency,p.preferred_fulfillment,p.notes,p.sms_consent_at,
    NULL,p.revision,p.created_by,p.updated_by,p.created_at,p.updated_at
  FROM dog_food_customer_profiles p JOIN dog_food_customers c ON c.id=p.customer_id;
DROP TABLE dog_food_customer_profiles;
ALTER TABLE dog_food_customer_profiles_next RENAME TO dog_food_customer_profiles;
CREATE TABLE dog_food_customer_consent_events (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES dog_food_customers(id),
  channel TEXT NOT NULL CHECK(channel='sms'), phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('granted','cleared','migrated')),
  consent_at TEXT, evidence TEXT NOT NULL CHECK(json_valid(evidence)),
  recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO dog_food_customer_consent_events(id,customer_id,channel,phone,status,consent_at,evidence,recorded_by)
  SELECT 'existing-sms:'||p.customer_id,p.customer_id,'sms',c.phone,'migrated',p.sms_consent_at,
    json_object('source','existing_stored_consent','phone_at_migration_unverified',json('true'),'new_consent_inferred',json('false')),p.updated_by
  FROM dog_food_customer_profiles p JOIN dog_food_customers c ON c.id=p.customer_id
  WHERE NULLIF(trim(p.sms_consent_at),'') IS NOT NULL;
CREATE TRIGGER food_customer_consent_events_no_update BEFORE UPDATE ON dog_food_customer_consent_events BEGIN
  SELECT RAISE(ABORT,'Consent history is retained');
END;
CREATE TRIGGER food_customer_consent_events_no_delete BEFORE DELETE ON dog_food_customer_consent_events BEGIN
  SELECT RAISE(ABORT,'Consent history is retained');
END;
ALTER TABLE dog_food_customer_commands ADD COLUMN action TEXT NOT NULL DEFAULT 'legacy';
UPDATE dog_food_customer_commands SET action=COALESCE((SELECT a.action FROM dog_food_ops_audit a
  WHERE json_extract(a.details,'$.commandId')=dog_food_customer_commands.id
  AND a.action IN('create_customer','update_customer','invite_customer','set_customer_status') LIMIT 1),'legacy');
ALTER TABLE dog_food_account_tokens ADD COLUMN customer_id TEXT REFERENCES dog_food_customers(id);
