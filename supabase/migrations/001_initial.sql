-- Enable pgvector (needed in Phase 2, enable now)
create extension if not exists vector;

-- Users table is managed by Supabase Auth (auth.users)
-- We create a public profile that mirrors it

create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Chat sessions
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

alter table public.chat_sessions enable row level security;
create policy "Users can manage own sessions" on public.chat_sessions
  for all using (auth.uid() = user_id);

-- Messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.chat_sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;
create policy "Users can manage own messages" on public.messages
  for all using (auth.uid() = user_id);

-- Index for fast session message lookup
create index messages_session_id_idx on public.messages(session_id, created_at);
