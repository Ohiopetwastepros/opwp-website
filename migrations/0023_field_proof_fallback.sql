ALTER TABLE route_partner_field_proofs ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'r2'
  CHECK (storage_provider IN ('r2', 'd1'));
ALTER TABLE route_partner_field_proofs ADD COLUMN image_data BLOB;
