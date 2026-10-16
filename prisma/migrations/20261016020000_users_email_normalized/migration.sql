-- Preserve historical identities. Fail visibly instead of merging/deleting collisions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User" GROUP BY lower(trim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce normalized email uniqueness: historical identities collide on lower(trim(email)); resolve identities explicitly before retrying migration';
  END IF;
END $$;
CREATE UNIQUE INDEX "User_email_normalized_key" ON "User" (lower(trim(email)));
