-- ============================================================
-- Summer Analytics 2025 — Full Platform Schema
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Profiles ─────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid references auth.users on delete cascade primary key,
  email         text unique not null,
  full_name     text,
  college       text,
  year_of_study text,
  branch        text,
  phone         text,
  roll_number   text,
  is_admin      boolean default false,
  created_at    timestamptz default now()
);

-- ── Announcements ─────────────────────────────────────────────
create table if not exists public.announcements (
  id          uuid default gen_random_uuid() primary key,
  title       text not null,
  body        text,
  links       jsonb default '[]',  -- [{label, url}]
  is_active   boolean default true,
  pinned      boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── Weeks (course structure) ──────────────────────────────────
create table if not exists public.weeks (
  id           uuid default gen_random_uuid() primary key,
  week_number  int unique not null,
  title        text not null default '',
  is_published boolean default false,
  published_at timestamptz,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Week Days (content rows) ──────────────────────────────────
create table if not exists public.week_days (
  id           uuid default gen_random_uuid() primary key,
  week_id      uuid references public.weeks(id) on delete cascade,
  week_number  int not null,
  day_number   int not null,  -- 1..7
  description  text,
  task1_label  text, task1_url text,
  task2_label  text, task2_url text,
  task3_label  text, task3_url text,
  sort_order   int default 0,
  unique(week_id, day_number)
);

-- ── Quiz Config (one row per week quiz) ───────────────────────
create table if not exists public.quiz_config (
  id              uuid default gen_random_uuid() primary key,
  week_number     int unique not null,
  quiz_title      text,
  quiz_url        text,       -- TestPortal URL or any quiz URL
  test_id         text,       -- TestPortal test ID
  is_active       boolean default false,
  opens_at        timestamptz,
  closes_at       timestamptz,
  max_score       numeric default 100,
  time_limit_mins int default 30,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── Quiz Scores ───────────────────────────────────────────────
create table if not exists public.quiz_scores (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references public.profiles(id) on delete cascade,
  email           text,
  week_number     int,
  score           numeric,
  max_score       numeric,
  percentage      numeric,
  feedback        text,
  answers         jsonb default '[]',  -- [{question, chosen, correct, is_correct}]
  tab_switches    int default 0,
  fullscreen_exits int default 0,
  time_taken_secs  int,
  submitted_at    timestamptz default now(),
  unique(user_id, week_number)
);

-- ── Quiz Violations (detailed log) ───────────────────────────
create table if not exists public.quiz_violations (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references public.profiles(id) on delete cascade,
  week_number    int,
  violation_type text check (violation_type in ('tab_switch','fullscreen_exit','window_blur','devtools')),
  occurred_at    timestamptz default now()
);

-- ── AI Usage (rate limiting) ──────────────────────────────────
create table if not exists public.ai_usage (
  user_id       uuid references public.profiles(id) on delete cascade,
  date          date default current_date,
  message_count int default 0,
  primary key (user_id, date)
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.announcements   enable row level security;
alter table public.weeks           enable row level security;
alter table public.week_days       enable row level security;
alter table public.quiz_config     enable row level security;
alter table public.quiz_scores     enable row level security;
alter table public.quiz_violations enable row level security;
alter table public.ai_usage        enable row level security;

-- profiles
create policy "profiles: own select"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: own insert"   on public.profiles for insert with check (auth.uid() = id);
create policy "profiles: own update"   on public.profiles for update using (auth.uid() = id);

-- announcements: everyone authenticated can read
create policy "announcements: auth read" on public.announcements for select to authenticated using (true);
create policy "announcements: admin write" on public.announcements for all
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- weeks: published weeks readable by all authenticated
create policy "weeks: auth read published" on public.weeks for select to authenticated
  using (is_published = true or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
create policy "weeks: admin write" on public.weeks for all
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- week_days: published weeks
create policy "week_days: auth read" on public.week_days for select to authenticated
  using (exists (select 1 from public.weeks w where w.id = week_id and (w.is_published = true or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))));
create policy "week_days: admin write" on public.week_days for all
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- quiz_config: active quizzes visible to all authenticated
create policy "quiz_config: auth read" on public.quiz_config for select to authenticated using (true);
create policy "quiz_config: admin write" on public.quiz_config for all
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- quiz_scores: own rows + admin reads all
create policy "quiz_scores: own select" on public.quiz_scores for select
  using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
create policy "quiz_scores: auth read all (leaderboard)" on public.quiz_scores for select to authenticated using (true);

-- quiz_violations: own rows + admin
create policy "quiz_violations: own insert" on public.quiz_violations for insert with check (auth.uid() = user_id);
create policy "quiz_violations: admin read" on public.quiz_violations for select
  using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- ai_usage
create policy "ai_usage: own rows" on public.ai_usage for all using (auth.uid() = user_id);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_quiz_scores_user   on public.quiz_scores (user_id);
create index if not exists idx_quiz_scores_week   on public.quiz_scores (week_number);
create index if not exists idx_profiles_email     on public.profiles (email);
create index if not exists idx_week_days_week     on public.week_days (week_number);
create index if not exists idx_violations_user    on public.quiz_violations (user_id);

-- ============================================================
-- Seed: initial weeks (unpublished)
-- ============================================================
insert into public.weeks (week_number, title, is_published) values
  (1, 'Week 1', false),
  (2, 'Week 2', false),
  (3, 'Week 3', false),
  (4, 'Week 4', false),
  (5, 'Week 5', false)
on conflict (week_number) do nothing;

-- ============================================================
-- Realtime (optional)
-- ============================================================
-- alter publication supabase_realtime add table public.quiz_scores;
-- alter publication supabase_realtime add table public.announcements;
