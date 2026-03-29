## Nadeef

Nadeef is a home cleaning support tool built with Next.js, prepared for:

- Supabase as the backend database/auth service
- Vercel deployment
- Stitch dashboard UI structure from your `stitch_dashboard_nadeef` assets

## Project Structure

- `src/app/page.tsx` - home launcher for all UI screens
- `src/app/design/[slug]/page.tsx` - dynamic route that renders each stitched design
- `src/lib/design-screens.ts` - central screen registry
- `src/lib/supabase/client.ts` - browser Supabase client
- `src/lib/supabase/server.ts` - server Supabase client
- `public/designs/*/code.html` - copied stitch dashboard screens

## Local Setup

1. Install dependencies:
   `npm install`

2. Configure environment variables:
   - Copy `.env.example` to `.env.local`
   - Set your Supabase project values:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - In Supabase Auth -> URL Configuration, add these redirect URLs:
    - `http://localhost:3000/oauth/consent`
    - `https://<your-vercel-domain>/oauth/consent`
  - For MVP, email/password auth is enough (no social providers required).

3. Run development server:
   `npm run dev`

4. Open:
   [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Import this project in Vercel.
2. In Project Settings -> Environment Variables, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy.

Vercel automatically detects Next.js settings; no additional build config is required.

## Supabase Database Setup

1. Open your Supabase project.
2. Go to `SQL Editor`.
3. Open `supabase/schema.sql` from this project and run it.
4. This creates:
   - `house`
   - `user_house_bridge`
   - `room`
   - `task`
   - `task_history`
   - enums, indexes, triggers, and RLS policies

### MVP Constraint (one home per user)

For MVP, we enforce one home per user with:

- `user_house_bridge_one_home_per_user_idx`

When you are ready for multi-home per user, run:

```sql
drop index if exists public.user_house_bridge_one_home_per_user_idx;
```

## Current UI Routes

- `/` (real login/sign-up page with Supabase auth)
- `/setup` (first-time only: create house)
- `/home` (house dashboard with room cards and Add Room card)
- `/oauth/consent` (OAuth callback processor)
- `/auth/callback` (legacy callback alias)
- `/design/login`
- `/design/dashboard`
- `/design/tasks`
- `/design/task-new`
- `/design/room-new`
- `/design/kitchen`
- `/design/leaderboard`
- `/design/profile`
- `/design/theme-preview`
