-- Nadeef MVP schema for Supabase (PostgreSQL)
-- Notes:
-- 1) This schema supports future multi-home, but currently enforces one home per user.
-- 2) All user references point to auth.users(id).

create extension if not exists pgcrypto;

-- ===== Enums =====
do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_role') then
    create type public.membership_role as enum ('owner', 'member', 'helper');
  end if;

  if not exists (select 1 from pg_type where typname = 'room_type') then
    create type public.room_type as enum (
      'kitchen',
      'bathroom',
      'bedroom',
      'living_room',
      'dining_room',
      'laundry',
      'garage',
      'outdoor',
      'office',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('active', 'paused');
  end if;
end $$;

-- ===== Helper functions =====
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.generate_invite_code()
returns text
language sql
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

-- ===== Tables =====
create table if not exists public.house (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default public.generate_invite_code(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  timezone text not null default 'UTC',
  is_paused boolean not null default false,
  travel_mode_started_at timestamptz,
  travel_offset_days integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.house
  add column if not exists travel_mode_started_at timestamptz;

alter table public.house
  add column if not exists travel_offset_days integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'house_travel_offset_days_non_negative'
  ) then
    alter table public.house
      add constraint house_travel_offset_days_non_negative
      check (travel_offset_days >= 0);
  end if;
end $$;

create table if not exists public.user_house_bridge (
  user_id uuid not null references auth.users(id) on delete cascade,
  house_id uuid not null references public.house(id) on delete cascade,
  role public.membership_role not null default 'member',
  display_name text,
  avatar_url text,
  notifications_enabled boolean not null default true,
  total_points integer not null default 0 check (total_points >= 0),
  current_streak_days integer not null default 0,
  last_opened_on date,
  last_seen_travel_offset_days integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, house_id)
);

alter table public.user_house_bridge
  add column if not exists display_name text;

alter table public.user_house_bridge
  add column if not exists avatar_url text;

alter table public.user_house_bridge
  add column if not exists notifications_enabled boolean not null default true;

alter table public.user_house_bridge
  add column if not exists current_streak_days integer not null default 0;

alter table public.user_house_bridge
  add column if not exists last_opened_on date;

alter table public.user_house_bridge
  add column if not exists last_seen_travel_offset_days integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_house_bridge_streak_non_negative'
  ) then
    alter table public.user_house_bridge
      add constraint user_house_bridge_streak_non_negative
      check (current_streak_days >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_house_bridge_last_seen_travel_offset_non_negative'
  ) then
    alter table public.user_house_bridge
      add constraint user_house_bridge_last_seen_travel_offset_non_negative
      check (last_seen_travel_offset_days >= 0);
  end if;
end $$;

-- MVP rule: one home per user (drop this index later to allow many homes per user).
create unique index if not exists user_house_bridge_one_home_per_user_idx
  on public.user_house_bridge(user_id);

create table if not exists public.room (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.house(id) on delete cascade,
  name text not null,
  type public.room_type not null default 'other',
  icon_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (house_id, name),
  unique (id, house_id)
);

create table if not exists public.task (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  house_id uuid not null references public.house(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_user_ids uuid[] not null default '{}',
  assignment_mode text not null default 'together',
  name text not null,
  frequency_days integer not null check (frequency_days > 0),
  effort_points integer not null default 10 check (effort_points >= 0),
  last_completed_at timestamptz,
  next_due_date date,
  status public.task_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_room_house_fk
    foreign key (room_id, house_id)
    references public.room(id, house_id)
    on delete cascade
);

alter table public.task
  add column if not exists assigned_user_ids uuid[] not null default '{}';

alter table public.task
  add column if not exists assignment_mode text not null default 'together';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'task_assignment_mode_valid'
  ) then
    alter table public.task
      add constraint task_assignment_mode_valid
      check (assignment_mode in ('together', 'round_robin'));
  end if;
end $$;

create table if not exists public.task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  previous_due_date date,
  points_awarded integer not null check (points_awarded >= 0),
  created_at timestamptz not null default now()
);

alter table public.task_history
  add column if not exists previous_due_date date;

create table if not exists public.task_library (
  id uuid primary key default gen_random_uuid(),
  room_template text not null,
  name text not null,
  default_frequency_days integer not null default 3 check (default_frequency_days > 0),
  default_effort integer not null default 1 check (default_effort between 1 and 3),
  created_at timestamptz not null default now(),
  unique (room_template, name)
);

create table if not exists public.push_subscription (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  house_id uuid not null references public.house(id) on delete cascade,
  endpoint text not null unique,
  p256dh text,
  auth text,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.push_reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  house_id uuid not null references public.house(id) on delete cascade,
  slot text not null check (slot in ('morning', 'evening')),
  local_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, house_id, slot, local_date)
);

-- ===== Triggers =====
drop trigger if exists set_house_updated_at on public.house;
create trigger set_house_updated_at
before update on public.house
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_user_house_bridge_updated_at on public.user_house_bridge;
create trigger set_user_house_bridge_updated_at
before update on public.user_house_bridge
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_room_updated_at on public.room;
create trigger set_room_updated_at
before update on public.room
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_task_updated_at on public.task;
create trigger set_task_updated_at
before update on public.task
for each row execute function public.tg_set_updated_at();

-- Add owner membership row automatically when a house is created.
create or replace function public.tg_add_house_owner_to_bridge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_house_bridge (user_id, house_id, role, total_points)
  values (new.owner_id, new.id, 'owner', 0)
  on conflict (user_id, house_id) do nothing;

  return new;
end;
$$;

drop trigger if exists add_house_owner_to_bridge on public.house;
create trigger add_house_owner_to_bridge
after insert on public.house
for each row execute function public.tg_add_house_owner_to_bridge();

-- When a task is completed, update task timing, user points, and streak.
create or replace function public.tg_apply_task_completion()
returns trigger
language plpgsql
as $$
declare
  v_house_id uuid;
  v_frequency integer;
  v_last_streak_on date;
  v_last_seen_travel_offset integer;
  v_current_streak integer;
  v_total_travel_offset integer;
  v_completion_date date;
  v_raw_gap integer;
  v_travel_gap integer;
  v_effective_gap integer;
  v_next_streak integer;
  v_has_overdue boolean;
  v_has_due_remaining boolean;
begin
  select t.house_id, t.frequency_days
    into v_house_id, v_frequency
  from public.task t
  where t.id = new.task_id;

  if v_house_id is null then
    raise exception 'Task not found for task_history row %', new.id;
  end if;

  update public.task
  set
    last_completed_at = new.completed_at,
    next_due_date = (new.completed_at::date + (v_frequency || ' days')::interval)::date
  where id = new.task_id;

  -- Lock membership row to keep streak updates consistent during concurrent completions.
  select
    b.last_opened_on,
    b.last_seen_travel_offset_days,
    b.current_streak_days
  into
    v_last_streak_on,
    v_last_seen_travel_offset,
    v_current_streak
  from public.user_house_bridge b
  where b.user_id = new.user_id
    and b.house_id = v_house_id
  for update;

  select h.travel_offset_days
    into v_total_travel_offset
  from public.house h
  where h.id = v_house_id;

  v_completion_date := new.completed_at::date;
  -- New streak rules:
  -- 1) If user has ANY overdue assigned tasks, streak resets to 1.
  -- 2) Streak only increments when user has finished ALL assigned due/overdue tasks for the day.
  select exists (
    select 1
    from public.task t
    where t.house_id = v_house_id
      and t.status = 'active'
      and t.next_due_date is not null
      and t.next_due_date < v_completion_date
      and (
        t.assigned_to = new.user_id
        or (t.assigned_user_ids is not null and new.user_id = any(t.assigned_user_ids))
      )
  ) into v_has_overdue;

  select exists (
    select 1
    from public.task t
    where t.house_id = v_house_id
      and t.status = 'active'
      and t.next_due_date is not null
      and t.next_due_date <= v_completion_date
      and (
        t.assigned_to = new.user_id
        or (t.assigned_user_ids is not null and new.user_id = any(t.assigned_user_ids))
      )
  ) into v_has_due_remaining;

  if v_has_overdue then
    v_next_streak := 1;
  elsif v_has_due_remaining then
    -- Not all due tasks are finished yet; keep current streak unchanged.
    v_next_streak := coalesce(v_current_streak, 0);
  elsif v_last_streak_on is null then
    v_next_streak := 1;
  elsif v_last_streak_on = v_completion_date then
    v_next_streak := coalesce(v_current_streak, 0);
  else
    v_raw_gap := greatest(0, v_completion_date - v_last_streak_on);
    v_travel_gap := greatest(0, coalesce(v_total_travel_offset, 0) - coalesce(v_last_seen_travel_offset, 0));
    v_effective_gap := greatest(0, v_raw_gap - v_travel_gap);
    if v_effective_gap <= 1 then
      v_next_streak := coalesce(v_current_streak, 0) + 1;
    else
      v_next_streak := 1;
    end if;
  end if;

  update public.user_house_bridge
  set
    total_points = total_points + new.points_awarded,
    current_streak_days = v_next_streak,
    last_opened_on = case
      when v_has_overdue or not v_has_due_remaining then v_completion_date
      else last_opened_on
    end,
    last_seen_travel_offset_days = coalesce(v_total_travel_offset, 0)
  where user_id = new.user_id
    and house_id = v_house_id;

  return new;
end;
$$;

drop trigger if exists apply_task_completion on public.task_history;
create trigger apply_task_completion
after insert on public.task_history
for each row execute function public.tg_apply_task_completion();

-- Apply travel-mode offset when user turns travel mode off.
create or replace function public.apply_travel_mode_offset(p_house_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz;
  v_offset_days integer := 0;
begin
  if not public.is_house_member(p_house_id) then
    raise exception 'Not allowed to update this house';
  end if;

  select h.travel_mode_started_at
    into v_started_at
  from public.house h
  where h.id = p_house_id
  for update;

  if v_started_at is not null then
    v_offset_days := floor(extract(epoch from (now() - v_started_at)) / 86400);
    v_offset_days := greatest(v_offset_days, 0);
  end if;

  if v_offset_days > 0 then
    update public.task t
    set next_due_date = (t.next_due_date + make_interval(days => v_offset_days))::date
    where t.house_id = p_house_id
      and t.next_due_date is not null;
  end if;

  update public.house h
  set
    is_paused = false,
    travel_mode_started_at = null,
    travel_offset_days = h.travel_offset_days + v_offset_days
  where h.id = p_house_id;

  return v_offset_days;
end;
$$;

-- Leaderboard helper: range-based points across all app users or a single home.
create or replace function public.get_leaderboard_points(
  p_scope text,
  p_range text,
  p_house_id uuid default null
)
returns table (
  user_id uuid,
  points bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_scope not in ('global', 'home') then
    raise exception 'Invalid scope: %', p_scope;
  end if;

  if p_range not in ('weekly', 'monthly', 'all') then
    raise exception 'Invalid range: %', p_range;
  end if;

  if p_scope = 'home' then
    if p_house_id is null then
      raise exception 'p_house_id is required for home scope';
    end if;
    if not public.is_house_member(p_house_id) then
      raise exception 'Not allowed to view this home leaderboard';
    end if;
  end if;

  if p_range = 'weekly' then
    v_since := date_trunc('week', now());
  elsif p_range = 'monthly' then
    v_since := date_trunc('month', now());
  else
    v_since := null;
  end if;

  return query
  with scoped_houses as (
    select h.id as house_id
    from public.house h
    where p_scope = 'global'
       or (p_scope = 'home' and h.id = p_house_id)
  ),
  base_users as (
    select distinct b.user_id
    from public.user_house_bridge b
    join scoped_houses sh on sh.house_id = b.house_id
  ),
  task_stats as (
    select
      h.user_id,
      count(*)::bigint as tasks_done,
      coalesce(sum(h.points_awarded), 0)::bigint as effort_points
    from public.task_history h
    join public.task t on t.id = h.task_id
    where h.user_id in (select bu.user_id from base_users bu)
      and (v_since is null or h.completed_at >= v_since)
      and t.house_id in (select house_id from scoped_houses)
    group by h.user_id
  ),
  house_freshness as (
    select
      t.house_id,
      count(*) filter (where t.status = 'active')::bigint as active_total,
      count(*) filter (
        where t.status = 'active'
          and t.next_due_date is not null
          and t.next_due_date <= current_date
      )::bigint as due_now
    from public.task t
    where t.house_id in (select house_id from scoped_houses)
    group by t.house_id
  ),
  user_house_freshness as (
    select
      b.user_id,
      coalesce(
        avg(
          case
            when coalesce(hf.active_total, 0) = 0 then 100
            else round(((hf.active_total - hf.due_now) * 100.0) / hf.active_total)
          end
        ),
        100
      )::bigint as freshness_score
    from public.user_house_bridge b
    join scoped_houses sh on sh.house_id = b.house_id
    left join house_freshness hf on hf.house_id = b.house_id
    group by b.user_id
  ),
  user_streak as (
    select
      b.user_id,
      coalesce(max(b.current_streak_days), 0)::bigint as streak_days
    from public.user_house_bridge b
    join scoped_houses sh on sh.house_id = b.house_id
    group by b.user_id
  )
  select
    bu.user_id,
    round(
      1000 * (
        (least(coalesce(ts.effort_points, 0)::numeric / 300.0, 1.0) * 0.20)
        + (least(coalesce(ts.tasks_done, 0)::numeric / 30.0, 1.0) * 0.20)
        + (
          greatest(0.0, least(coalesce(uhf.freshness_score, 100)::numeric, 100.0)) / 100.0
        ) * 0.30
        + (least(coalesce(us.streak_days, 0)::numeric / 30.0, 1.0) * 0.30)
      )
    )::bigint as points
  from base_users bu
  left join task_stats ts on ts.user_id = bu.user_id
  left join user_house_freshness uhf on uhf.user_id = bu.user_id
  left join user_streak us on us.user_id = bu.user_id
  order by points desc, bu.user_id asc;
end;
$$;

-- ===== Indexes =====
create index if not exists house_owner_idx on public.house(owner_id);
create index if not exists room_house_idx on public.room(house_id);
create index if not exists task_house_idx on public.task(house_id);
create index if not exists task_room_idx on public.task(room_id);
create index if not exists task_assigned_to_idx on public.task(assigned_to);
create index if not exists task_due_date_idx on public.task(next_due_date);
create index if not exists task_history_task_idx on public.task_history(task_id);
create index if not exists task_history_user_idx on public.task_history(user_id);
create index if not exists task_history_completed_at_idx on public.task_history(completed_at desc);
create index if not exists task_library_room_template_idx on public.task_library(room_template);
create index if not exists push_subscription_house_idx on public.push_subscription(house_id);
create index if not exists push_subscription_user_idx on public.push_subscription(user_id);
create index if not exists push_reminder_log_house_slot_date_idx
  on public.push_reminder_log(house_id, slot, local_date);

-- ===== RLS =====
alter table public.house enable row level security;
alter table public.user_house_bridge enable row level security;
alter table public.room enable row level security;
alter table public.task enable row level security;
alter table public.task_history enable row level security;
alter table public.task_library enable row level security;
alter table public.push_subscription enable row level security;
alter table public.push_reminder_log enable row level security;

create or replace function public.is_house_member(p_house_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_house_bridge b
    where b.house_id = p_house_id
      and b.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_house(p_house_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_house_bridge b
    where b.house_id = p_house_id
      and b.user_id = auth.uid()
      and b.role in ('owner', 'member')
  );
$$;

create or replace function public.join_house_by_invite_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_house_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select h.id
    into v_house_id
  from public.house h
  where upper(h.invite_code) = upper(trim(p_invite_code))
  limit 1;

  if v_house_id is null then
    raise exception 'Invalid house code';
  end if;

  if exists (
    select 1
    from public.user_house_bridge b
    where b.user_id = v_user_id
      and b.house_id = v_house_id
  ) then
    return v_house_id;
  end if;

  if exists (
    select 1
    from public.user_house_bridge b
    where b.user_id = v_user_id
      and b.house_id <> v_house_id
  ) then
    raise exception 'This account is already linked to another home';
  end if;

  insert into public.user_house_bridge (user_id, house_id, role, total_points)
  values (v_user_id, v_house_id, 'member', 0)
  on conflict (user_id, house_id) do nothing;

  return v_house_id;
end;
$$;

-- house policies
drop policy if exists house_select_policy on public.house;
create policy house_select_policy
on public.house
for select
using (owner_id = auth.uid() or public.is_house_member(id));

drop policy if exists house_insert_policy on public.house;
create policy house_insert_policy
on public.house
for insert
with check (owner_id = auth.uid());

drop policy if exists house_update_policy on public.house;
create policy house_update_policy
on public.house
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists house_delete_policy on public.house;
create policy house_delete_policy
on public.house
for delete
using (owner_id = auth.uid());

-- bridge policies
drop policy if exists bridge_select_policy on public.user_house_bridge;
create policy bridge_select_policy
on public.user_house_bridge
for select
using (
  public.is_house_member(house_id)
);

drop policy if exists bridge_insert_policy on public.user_house_bridge;
create policy bridge_insert_policy
on public.user_house_bridge
for insert
with check (
  exists (
    select 1
    from public.house h
    where h.id = house_id
      and h.owner_id = auth.uid()
  )
);

drop policy if exists bridge_update_policy on public.user_house_bridge;
create policy bridge_update_policy
on public.user_house_bridge
for update
using (
  exists (
    select 1
    from public.house h
    where h.id = house_id
      and h.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.house h
    where h.id = house_id
      and h.owner_id = auth.uid()
  )
);

drop policy if exists bridge_update_own_profile_policy on public.user_house_bridge;
create policy bridge_update_own_profile_policy
on public.user_house_bridge
for update
using (
  user_id = auth.uid()
  and public.is_house_member(house_id)
)
with check (
  user_id = auth.uid()
  and public.is_house_member(house_id)
);

drop policy if exists bridge_delete_policy on public.user_house_bridge;
create policy bridge_delete_policy
on public.user_house_bridge
for delete
using (
  exists (
    select 1
    from public.house h
    where h.id = house_id
      and h.owner_id = auth.uid()
  )
);

-- room policies
drop policy if exists room_select_policy on public.room;
create policy room_select_policy
on public.room
for select
using (public.is_house_member(house_id));

drop policy if exists room_insert_policy on public.room;
create policy room_insert_policy
on public.room
for insert
with check (public.can_manage_house(house_id));

drop policy if exists room_update_policy on public.room;
create policy room_update_policy
on public.room
for update
using (public.can_manage_house(house_id))
with check (public.can_manage_house(house_id));

drop policy if exists room_delete_policy on public.room;
create policy room_delete_policy
on public.room
for delete
using (public.can_manage_house(house_id));

-- task policies
drop policy if exists task_select_policy on public.task;
create policy task_select_policy
on public.task
for select
using (public.is_house_member(house_id));

drop policy if exists task_insert_policy on public.task;
create policy task_insert_policy
on public.task
for insert
with check (public.can_manage_house(house_id));

drop policy if exists task_update_policy on public.task;
create policy task_update_policy
on public.task
for update
using (public.can_manage_house(house_id))
with check (public.can_manage_house(house_id));

drop policy if exists task_delete_policy on public.task;
create policy task_delete_policy
on public.task
for delete
using (public.can_manage_house(house_id));

-- task_history policies
drop policy if exists task_history_select_policy on public.task_history;
create policy task_history_select_policy
on public.task_history
for select
using (
  exists (
    select 1
    from public.task t
    where t.id = task_id
      and public.is_house_member(t.house_id)
  )
);

drop policy if exists task_history_insert_policy on public.task_history;
create policy task_history_insert_policy
on public.task_history
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.task t
    where t.id = task_id
      and public.is_house_member(t.house_id)
  )
);

drop policy if exists task_history_delete_policy on public.task_history;
create policy task_history_delete_policy
on public.task_history
for delete
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.task t
    where t.id = task_id
      and public.is_house_member(t.house_id)
  )
);

-- task_library policies
drop policy if exists task_library_select_policy on public.task_library;
create policy task_library_select_policy
on public.task_library
for select
using (auth.uid() is not null);

-- push_subscription policies
drop policy if exists push_subscription_select_policy on public.push_subscription;
create policy push_subscription_select_policy
on public.push_subscription
for select
using (
  user_id = auth.uid()
  and public.is_house_member(house_id)
);

drop policy if exists push_subscription_insert_policy on public.push_subscription;
create policy push_subscription_insert_policy
on public.push_subscription
for insert
with check (
  user_id = auth.uid()
  and public.is_house_member(house_id)
);

drop policy if exists push_subscription_update_policy on public.push_subscription;
create policy push_subscription_update_policy
on public.push_subscription
for update
using (
  user_id = auth.uid()
  and public.is_house_member(house_id)
)
with check (
  user_id = auth.uid()
  and public.is_house_member(house_id)
);

drop policy if exists push_subscription_delete_policy on public.push_subscription;
create policy push_subscription_delete_policy
on public.push_subscription
for delete
using (
  user_id = auth.uid()
  and public.is_house_member(house_id)
);

-- push_reminder_log policies
drop policy if exists push_reminder_log_select_policy on public.push_reminder_log;
create policy push_reminder_log_select_policy
on public.push_reminder_log
for select
using (
  user_id = auth.uid()
  and public.is_house_member(house_id)
);

-- ===== Storage: profile pictures =====
insert into storage.buckets (id, name, public)
values ('profile-pictures', 'profile-pictures', true)
on conflict (id) do update
set public = true;

drop policy if exists profile_pictures_public_read on storage.objects;
create policy profile_pictures_public_read
on storage.objects
for select
using (bucket_id = 'profile-pictures');

drop policy if exists profile_pictures_insert_own on storage.objects;
create policy profile_pictures_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-pictures'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists profile_pictures_update_own on storage.objects;
create policy profile_pictures_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-pictures'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-pictures'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists profile_pictures_delete_own on storage.objects;
create policy profile_pictures_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-pictures'
  and (storage.foldername(name))[1] = auth.uid()::text
);

