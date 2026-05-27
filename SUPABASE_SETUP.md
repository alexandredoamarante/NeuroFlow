# Supabase Setup Guide for Neuroaark

To enable cloud synchronization for authenticated users, follow these steps to configure your Supabase project.

## 1. Database Migration

Run the provided SQL migration to create the necessary tables and security policies.

1.  Go to the [Supabase Dashboard](https://supabase.com/dashboard).
2.  Select your project.
3.  Navigate to the **SQL Editor** in the left sidebar.
4.  Click **New query**.
5.  Copy the contents of `supabase/migrations/20240527000000_create_tasks_table.sql` and paste it into the editor.
6.  Click **Run**.

## 2. Authentication Configuration (Google OAuth)

Neuroaark uses Google OAuth for authentication.

1.  Navigate to **Authentication** > **Providers**.
2.  Enable **Google**.
3.  Configure your **Client ID** and **Client Secret** (obtained from the [Google Cloud Console](https://console.cloud.google.com/)).
4.  Add the following URL to your **Redirect URLs** in the Supabase Auth settings:
    - `https://neuroaark.pages.dev`
5.  Ensure that **External OAuth Providers** are configured to use the site URL as the base.

## 3. Row Level Security (RLS)

The migration automatically enables RLS and creates policies. To verify:

1.  Navigate to **Authentication** > **Policies**.
2.  Find the `tasks` table.
3.  Verify that there are 4 policies (SELECT, INSERT, UPDATE, DELETE) restricted to `auth.uid() = user_id`.

## 4. Realtime Configuration

Neuroaark uses Supabase Realtime to keep devices in sync without page refreshes.

1.  Navigate to **Database** > **Replication**.
2.  In the **supabase_realtime** publication, click on **Source**.
3.  Ensure that the `tasks` table is toggled **ON**.
    - *Note: The SQL migration attempts to do this automatically, but manual verification is recommended.*

## 5. API Settings

Ensure your application uses the correct public keys. These are already configured in `js/storage.js`:

- **Project URL:** `https://bdvwpyiabmmfsvsjytxn.supabase.co`
- **Anon Public Key:** `sb_publishable_6YztmsKgxkLH-8OPtR14Wg_9EOeQTHo`

**Important:** Never use the `service_role` key on the frontend.
