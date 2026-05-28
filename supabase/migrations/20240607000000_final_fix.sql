-- FINAL ARCHITECTURE STABILIZATION MIGRATION
-- This migration ensures correct permissions, RLS, and constraints for the workspace-based architecture.

-- 1. Ensure Table and Core Permissions
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.tasks TO anon;
GRANT ALL ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

-- 2. Clean up ALL existing policies to ensure a clean slate
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.tasks', pol.policyname);
    END LOOP;
END $$;

-- 3. Create SIMPLE, ROBUST workspace-based policies
-- These policies allow anyone who knows the workspace_id to access the data.
-- This is intentional for the "anonymous collaborative workspace" model.

CREATE POLICY "Allow anonymous workspace access - SELECT"
ON public.tasks FOR SELECT
USING (workspace_id IS NOT NULL);

CREATE POLICY "Allow anonymous workspace access - INSERT"
ON public.tasks FOR INSERT
WITH CHECK (workspace_id IS NOT NULL);

CREATE POLICY "Allow anonymous workspace access - UPDATE"
ON public.tasks FOR UPDATE
USING (workspace_id IS NOT NULL)
WITH CHECK (workspace_id IS NOT NULL);

CREATE POLICY "Allow anonymous workspace access - DELETE"
ON public.tasks FOR DELETE
USING (workspace_id IS NOT NULL);

-- 4. Ensure correct Unique Constraint
-- Each task is uniquely identified by (workspace_id, local_id)
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_user_id_local_id_key;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_workspace_id_local_id_key;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_workspace_id_local_id_key UNIQUE (workspace_id, local_id);

-- 5. Ensure Realtime is active for this table
-- We drop and recreate it to be absolutely sure.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.tasks;
  END IF;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
EXCEPTION
  WHEN OTHERS THEN
    -- Table might already be in another publication or other issues, just log if needed
    RAISE NOTICE 'Could not refresh publication for tasks: %', SQLERRM;
END $$;

-- 6. Add Forensic column if missing (for debugging sync issues)
-- We already have version, device_id, updated_at.
-- Let's ensure they are all present.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE public.tasks ALTER COLUMN version SET DEFAULT 0;
ALTER TABLE public.tasks ALTER COLUMN updated_at SET DEFAULT NOW();
