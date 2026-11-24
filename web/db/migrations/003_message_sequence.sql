-- Timestamps are display metadata, not an ordering primitive. The migration
-- runner holds one transaction/DDL lock through backfill and FORCE restoration.
ALTER TABLE messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE messages ADD COLUMN sequence_no bigint;

-- Legacy records have no recoverable insertion order for exact clock ties.
-- Use a stable user-before-assistant fallback for those ties; all new records
-- receive an identity value in actual insertion order regardless of the clock.
WITH ordered AS (
  SELECT id, row_number() OVER (
    ORDER BY created_at, conversation_id,
      CASE role WHEN 'user' THEN 0 ELSE 1 END, id
  ) AS sequence_no
  FROM messages
)
UPDATE messages AS message SET sequence_no = ordered.sequence_no
FROM ordered WHERE ordered.id = message.id;

ALTER TABLE messages
  ALTER COLUMN sequence_no SET NOT NULL,
  ALTER COLUMN sequence_no ADD GENERATED ALWAYS AS IDENTITY,
  ADD CONSTRAINT messages_sequence_positive CHECK (sequence_no > 0),
  ADD CONSTRAINT messages_sequence_unique UNIQUE (sequence_no);

-- Existing rows keep their assigned numbers. The next implicit value must
-- start strictly after them, including when this is an empty new database.
SELECT setval(
  pg_get_serial_sequence('public.messages', 'sequence_no')::regclass,
  COALESCE(max(sequence_no), 0) + 1,
  false
) FROM messages;

CREATE INDEX messages_conversation_sequence_idx
  ON messages (tenant_id, user_id, conversation_id, sequence_no);

-- GENERATED ALWAYS is a generation rule, not a privilege boundary: a role
-- with table-wide INSERT can use OVERRIDING SYSTEM VALUE, and table-wide
-- UPDATE permits SET sequence_no = DEFAULT. Restrict writes to other columns.
REVOKE INSERT, UPDATE ON messages FROM aoos_runtime;
GRANT INSERT (id, tenant_id, user_id, conversation_id, role, content, citations, created_at, memory_context_revision)
  ON messages TO aoos_runtime;
GRANT UPDATE (id, tenant_id, user_id, conversation_id, role, content, citations, created_at, memory_context_revision)
  ON messages TO aoos_runtime;

DO $$
DECLARE sequence_name text;
BEGIN
  sequence_name := pg_get_serial_sequence('public.messages', 'sequence_no');
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', sequence_name);
  -- Runtime may allocate values, but cannot reset/reseed the sequence.
  EXECUTE format('GRANT USAGE ON SEQUENCE %s TO aoos_runtime', sequence_name);
END;
$$;

ALTER TABLE messages FORCE ROW LEVEL SECURITY;
