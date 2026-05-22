-- ==========================================
-- MONOLITH // LIFT DATABASE SCHEMA
-- PostgreSQL / Supabase Relational Schema DDL
-- ==========================================

-- Enable UUID extension if not already present
create extension if not exists "uuid-ossp";

-- 1. Workout Sessions Container Table
-- Tracks individual training days / sessions
create table if not exists public.workouts (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    name text not null, -- e.g., 'Push Development Alpha', 'Pull Day'
    notes text
);

-- 2. Granular Exercise Log Grid Cells Table
-- Stores the individual row items of each workout grid
create table if not exists public.exercise_logs (
    id uuid default gen_random_uuid() primary key,
    workout_id uuid references public.workouts(id) on delete cascade not null,
    exercise_key text not null, -- Technical identifier (e.g. 'bench_press', 'squat')
    set_index integer not null, -- 0-based order tracking index (e.g. Set 1 is index 0)
    weight numeric(6, 2) not null default 0.00, -- Load in kg or lbs
    reps integer not null default 0, -- Reps executed
    completed boolean default false not null, -- Checkbox state for active calculation
    
    -- Constraint: Prevent duplicate sets at the same grid index for a single workout block
    unique (workout_id, exercise_key, set_index)
);

-- Index frequently scanned foreign keys for query efficiency
create index if not exists idx_exercise_logs_workout on public.exercise_logs(workout_id);

-- Example Query to retrieve full volumetric matrix:
-- SELECT 
--   w.name as workout_name,
--   w.created_at,
--   el.exercise_key,
--   el.set_index + 1 as set_number,
--   el.weight,
--   el.reps,
--   el.completed
-- FROM public.workouts w
-- JOIN public.exercise_logs el ON w.id = el.workout_id
-- ORDER BY w.created_at DESC, el.exercise_key, el.set_index;
