-- A memory change starts a new model-context revision. Display history is kept,
-- but no message from an earlier revision may be replayed to the model.
ALTER TABLE preferences
  ADD COLUMN memory_changed_at timestamptz NOT NULL DEFAULT 'epoch'::timestamptz,
  ADD COLUMN memory_revision bigint NOT NULL DEFAULT 0 CHECK (memory_revision >= 0);

ALTER TABLE messages
  ADD COLUMN memory_context_revision bigint NOT NULL DEFAULT 0 CHECK (memory_context_revision >= 0);

-- Conservatively exclude legacy history: earlier answers may contain memory
-- that was subsequently deleted, and its origin cannot be reconstructed.
-- The runner wraps this migration in one transaction. Temporarily allow its
-- table owner to perform the backfill; all non-owner runtime roles retain RLS.
-- ALTER TABLE holds the lock until commit, and FORCE is restored below.
ALTER TABLE conversations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE preferences NO FORCE ROW LEVEL SECURITY;
INSERT INTO preferences (tenant_id, user_id, memory_enabled)
SELECT DISTINCT tenant_id, user_id, false FROM conversations
ON CONFLICT (tenant_id, user_id) DO NOTHING;
UPDATE preferences SET memory_changed_at = clock_timestamp(), memory_revision = 1;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE preferences FORCE ROW LEVEL SECURITY;

CREATE FUNCTION aoos_memory_preference_boundary() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.memory_enabled THEN
      NEW.memory_changed_at := clock_timestamp();
      NEW.memory_revision := GREATEST(NEW.memory_revision, 1);
    END IF;
  ELSIF NEW.memory_enabled IS DISTINCT FROM OLD.memory_enabled THEN
    NEW.memory_changed_at := clock_timestamp();
    NEW.memory_revision := OLD.memory_revision + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_preference_boundary
BEFORE INSERT OR UPDATE OF memory_enabled ON preferences
FOR EACH ROW EXECUTE FUNCTION aoos_memory_preference_boundary();

CREATE FUNCTION aoos_saved_memory_boundary() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  scoped_tenant uuid;
  scoped_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    scoped_tenant := OLD.tenant_id;
    scoped_user := OLD.user_id;
  ELSE
    scoped_tenant := NEW.tenant_id;
    scoped_user := NEW.user_id;
  END IF;

  -- Invoker permissions and RLS still apply. The membership check also avoids
  -- recreating a preference row during a cascading membership deletion.
  INSERT INTO preferences (tenant_id, user_id, memory_enabled, memory_changed_at, memory_revision)
  SELECT scoped_tenant, scoped_user, false, clock_timestamp(), 1
  WHERE EXISTS (SELECT 1 FROM memberships WHERE tenant_id = scoped_tenant AND user_id = scoped_user)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET
    memory_changed_at = clock_timestamp(),
    memory_revision = preferences.memory_revision + 1;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER saved_memory_boundary
AFTER INSERT OR UPDATE OR DELETE ON memories
FOR EACH ROW EXECUTE FUNCTION aoos_saved_memory_boundary();
