-- FINAL IDENTITY & WORKSPACE STABILIZATION MIGRATION
-- This migration ensures the schema supports anonymous workspace identity correctly.

-- 1. Table Consistency
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 2. Column Adjustments
ALTER TABLE public.tasks ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE public.tasks ALTER COLUMN version SET DEFAULT 0;
ALTER TABLE public.tasks ALTER COLUMN updated_at SET DEFAULT NOW();

-- 3. Permissions
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.tasks TO anon;
GRANT ALL ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

-- 4. Clean Policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.tasks', pol.policyname);
    END LOOP;
END $$;

-- 5. Simple Workspace-Key Policies (Account Identity = Workspace Key)
CREATE POLICY "Enable workspace access for all - SELECT"
ON public.tasks FOR SELECT
USING (workspace_id IS NOT NULL);

CREATE POLICY "Enable workspace access for all - INSERT"
ON public.tasks FOR INSERT
WITH CHECK (workspace_id IS NOT NULL);

CREATE POLICY "Enable workspace access for all - UPDATE"
ON public.tasks FOR UPDATE
USING (workspace_id IS NOT NULL)
WITH CHECK (workspace_id IS NOT NULL);

CREATE POLICY "Enable workspace access for all - DELETE"
ON public.tasks FOR DELETE
USING (workspace_id IS NOT NULL);

-- 6. Constraints
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_user_id_local_id_key;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_workspace_id_local_id_key;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_workspace_id_local_id_key UNIQUE (workspace_id, local_id);

-- 7. Realtime Publication
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
    RAISE NOTICE 'Realtime publication setup notice: %', SQLERRM;
END $$;
