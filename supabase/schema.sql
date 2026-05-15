create extension if not exists pgcrypto;

create table if not exists public.profiles (
  client_id text primary key,
  name text not null,
  country text not null check (country in ('GE', 'BY')),
  income_currency text not null check (income_currency in ('USD', 'EUR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.profiles(client_id) on delete cascade,
  month text not null,
  received_date date not null,
  country text not null check (country in ('GE', 'BY')),
  income_currency text not null check (income_currency in ('USD', 'EUR')),
  local_currency text not null check (local_currency in ('GEL', 'BYN')),
  income_amount numeric,
  local_amount numeric not null,
  tax_local numeric not null,
  tax_rate numeric not null,
  usd_amount numeric,
  gel_amount numeric,
  tax_gel numeric,
  rate numeric,
  rate_date date,
  source text not null,
  source_url text,
  created_at timestamptz,
  updated_at timestamptz,
  unique (client_id, country, income_currency, month)
);

create index if not exists entries_client_month_idx on public.entries (client_id, month);

create table if not exists public.rate_cache (
  cache_key text primary key,
  payload jsonb not null,
  cached_at timestamptz not null default now()
);
