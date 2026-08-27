ALTER TABLE route_partner_members
  ADD COLUMN is_platform_owner INTEGER NOT NULL DEFAULT 0
  CHECK (is_platform_owner IN (0, 1));

-- Preserve the effective access of accounts that used the legacy owner role.
UPDATE route_partner_members
SET is_platform_owner = 1
WHERE role = 'owner';
