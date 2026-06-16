-- Create table for tracking failed AI requests that need automatic retry
create table if not exists public.failed_ai_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null,
  chat_id text not null,
  session_id uuid not null,
  original_message text not null,
  error_message text,
  retry_count int not null default 0,
  max_retries int not null default 3,
  next_retry_at timestamp with time zone not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  status text not null default 'pending', -- pending, retrying, resolved, failed
  context_data jsonb,
  
  constraint retry_count_valid check (retry_count >= 0 and retry_count <= max_retries)
);

-- Add indexes for efficient querying
create index if not exists idx_failed_ai_requests_org_status on public.failed_ai_requests(org_id, status);
create index if not exists idx_failed_ai_requests_next_retry on public.failed_ai_requests(next_retry_at) where status = 'pending';
create index if not exists idx_failed_ai_requests_thread on public.failed_ai_requests(thread_id);

-- Add RLS policies
alter table public.failed_ai_requests enable row level security;

create policy "Users can only see their org requests" on public.failed_ai_requests
  for select using (
    exists (
      select 1 from public.user_roles
      where user_roles.org_id = failed_ai_requests.org_id
      and user_roles.user_id = auth.uid()
    )
  );

create policy "System can manage all retry requests" on public.failed_ai_requests
  for all using (true);
