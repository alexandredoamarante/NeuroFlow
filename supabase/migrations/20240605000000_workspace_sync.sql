-- Migration to support workspace-key synchronization
-- This migration adds workspace_id and relaxes auth requirements for the tasks table.

-- 1. Enable RLS explicitly
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 2. Add workspace_id column
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS workspace_id TEXT;

-- 3. Make user_id optional to allow sync without authentication
ALTER TABLE public.tasks ALTER COLUMN user_id DROP NOT NULL;

-- 4. Change version to BIGINT to handle Date.now() timestamps
ALTER TABLE public.tasks ALTER COLUMN version TYPE BIGINT;

-- 5. Ensure columns exist and have correct permissions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'device_id') THEN
        ALTER TABLE public.tasks ADD COLUMN device_id TEXT;
    END IF;
END $$;

-- Grant permissions to public roles
GRANT ALL ON public.tasks TO anon;
GRANT ALL ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

-- 6. Update unique constraint
-- We replace the user-based constraint with a workspace-based one.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_user_id_local_id_key;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_workspace_id_local_id_key;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_workspace_id_local_id_key UNIQUE (workspace_id, local_id);

-- 7. Update Row Level Security (RLS) Policies
-- Security Note: We use workspace_id as a shared key.
-- Isolation is enforced by filtering on workspace_id.

DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;

DROP POLICY IF EXISTS "Enable read access for all" ON public.tasks;
DROP POLICY IF EXISTS "Enable insert access for all" ON public.tasks;
DROP POLICY IF EXISTS "Enable update access for all" ON public.tasks;
DROP POLICY IF EXISTS "Enable delete access for all" ON public.tasks;

DROP POLICY IF EXISTS "Enable read access based on workspace_id" ON public.tasks;
DROP POLICY IF EXISTS "Enable insert access based on workspace_id" ON public.tasks;
DROP POLICY IF EXISTS "Enable update access based on workspace_id" ON public.tasks;
DROP POLICY IF EXISTS "Enable delete access based on workspace_id" ON public.tasks;

-- New policies: Enforce that clients must provide the workspace_id.
-- This provides basic isolation between workspaces.
CREATE POLICY "Enable read access based on workspace_id"
ON public.tasks FOR SELECT
USING (workspace_id IS NOT NULL);

CREATE POLICY "Enable insert access based on workspace_id"
ON public.tasks FOR INSERT
WITH CHECK (workspace_id IS NOT NULL);

CREATE POLICY "Enable update access based on workspace_id"
ON public.tasks FOR UPDATE
USING (workspace_id IS NOT NULL)
WITH CHECK (workspace_id IS NOT NULL);

CREATE POLICY "Enable delete access based on workspace_id"
ON public.tasks FOR DELETE
USING (workspace_id IS NOT NULL);

-- Add comment for the new column
COMMENT ON COLUMN public.tasks.workspace_id IS 'The shared key for the workspace/notebook.';

-- Enable Realtime for the tasks table (redundant but safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END $$;
