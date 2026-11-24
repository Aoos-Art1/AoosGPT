-- Run only with the dedicated migration/owner connection.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aoos_runtime') THEN
    CREATE ROLE aoos_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO aoos_runtime;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  platform_role text NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user', 'super_admin')),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('individual', 'company')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'professional', 'enterprise')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id, active);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('individual', 'company', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
  CHECK ((portal = 'admin' AND tenant_id IS NULL) OR
         (portal IN ('individual', 'company') AND tenant_id IS NOT NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES users(id),
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX invitations_tenant_idx ON invitations (tenant_id, email);

CREATE TABLE rate_limits (
  key text PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 300),
  hits integer NOT NULL CHECK (hits > 0),
  window_started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_idx ON audit_events (tenant_id, created_at DESC);

CREATE TABLE profiles (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  registration text NOT NULL DEFAULT '',
  activity text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT ''
);

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  job text NOT NULL DEFAULT '',
  nationality text NOT NULL CHECK (nationality IN ('saudi', 'other')),
  monthly_salary numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),
  document_expiry date,
  UNIQUE (tenant_id, id)
);
CREATE INDEX employees_tenant_idx ON employees (tenant_id);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX tasks_tenant_idx ON tasks (tenant_id);

CREATE TABLE letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  recipient text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id)
);
CREATE INDEX letters_owner_idx ON letters (tenant_id, user_id, updated_at DESC);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, user_id)
);
CREATE INDEX conversations_owner_idx ON conversations (tenant_id, user_id, updated_at DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, conversation_id, user_id)
    REFERENCES conversations(tenant_id, id, user_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id)
);
CREATE INDEX messages_conversation_idx ON messages (tenant_id, user_id, conversation_id, created_at);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id)
);
CREATE INDEX documents_tenant_idx ON documents (tenant_id, created_at DESC);

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL,
  content text NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, document_id, chunk_index)
);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id)
);
CREATE INDEX memories_owner_idx ON memories (tenant_id, user_id, created_at DESC);

CREATE TABLE preferences (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  memory_enabled boolean NOT NULL DEFAULT false,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, user_id)
);

-- Business queries fail closed without transaction-local tenant/user context.
-- This role is not a table owner; FORCE also protects accidental owner reads.
DO $$
DECLARE
  table_name text;
  read_check text;
  write_check text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles', 'employees', 'tasks', 'letters', 'conversations', 'messages',
    'documents', 'document_chunks', 'memories', 'preferences'
  ] LOOP
    read_check := 'tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
    IF table_name = ANY (ARRAY['letters', 'conversations', 'messages', 'memories', 'preferences']) THEN
      read_check := read_check || ' AND user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid';
    END IF;
    write_check := read_check || ' AND current_setting(''app.tenant_role'', true) IN (''owner'', ''admin'', ''member'')';
    IF table_name = ANY (ARRAY['profiles', 'employees', 'documents', 'document_chunks']) THEN
      write_check := read_check || ' AND current_setting(''app.tenant_role'', true) IN (''owner'', ''admin'')';
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_select ON %I FOR SELECT TO aoos_runtime USING (%s)', table_name, read_check);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT TO aoos_runtime WITH CHECK (%s)', table_name, write_check);
    EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE TO aoos_runtime USING (%s) WITH CHECK (%s)', table_name, write_check, write_check);
    EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE TO aoos_runtime USING (%s)', table_name, write_check);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO aoos_runtime', table_name);
  END LOOP;
END $$;

-- Identity/control-plane tables are accessible only through server auth/admin
-- services. Runtime SQL cannot promote a platform user, truncate tables, alter
-- RLS, or delete audit history. Bootstrap uses the separate migration role.
GRANT SELECT ON users TO aoos_runtime;
GRANT INSERT (id, email, display_name, password_hash) ON users TO aoos_runtime;
GRANT UPDATE (display_name, password_hash, disabled_at, updated_at) ON users TO aoos_runtime;
GRANT SELECT, INSERT ON tenants TO aoos_runtime;
GRANT UPDATE (name, status, plan, updated_at) ON tenants TO aoos_runtime;
GRANT SELECT, INSERT ON memberships TO aoos_runtime;
GRANT UPDATE (role, active) ON memberships TO aoos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO aoos_runtime;
GRANT SELECT, INSERT ON invitations TO aoos_runtime;
GRANT UPDATE (used_at, used_by, revoked_at) ON invitations TO aoos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO aoos_runtime;
GRANT SELECT, INSERT ON audit_events TO aoos_runtime;
