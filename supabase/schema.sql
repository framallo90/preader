-- ============================================================
-- intelliReader — Supabase schema
-- Ejecutar en el SQL Editor de Supabase (dashboard.supabase.com)
-- ============================================================

-- Habilitar RLS (Row Level Security) en todas las tablas
-- Habilitar la extensión UUID si no está activa
create extension if not exists "uuid-ossp";

-- ============================================================
-- profiles
-- Se crea automáticamente al registrar un usuario vía trigger.
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  is_premium  boolean not null default false,
  premium_until timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS: cada usuario solo ve y edita su propio perfil
alter table public.profiles enable row level security;

create policy "Usuarios ven su propio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Usuarios actualizan su propio perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- Trigger: crear perfil automáticamente al registrar usuario
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trigger: updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- Habilitar Realtime en la tabla profiles
-- (necesario para que premiumService detecte activación instantánea)
-- ============================================================
-- Ejecutar en el SQL Editor:
-- alter publication supabase_realtime add table public.profiles;
-- (esto no se puede hacer vía script SQL estándar en algunos planes)
