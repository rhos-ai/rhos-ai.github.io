# Careers Application Setup

The careers application form posts to `/api/applications`.

## Required Vercel environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `APPLICATION_FROM_EMAIL`
- `HR_NOTIFY_EMAIL` optional, defaults to `hr@rhos.ai`

`APPLICATION_FROM_EMAIL` must be a sender verified in Resend.

## Supabase Storage

Create a private bucket:

```text
career-resumes
```

## Supabase Table

Create table:

```sql
create table career_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_slug text not null,
  job_title text not null,
  name text not null,
  email text not null,
  phone text not null,
  profile_url text,
  notes text,
  resume_path text not null,
  resume_url text not null,
  status text not null default 'new'
);
```

The API uses the Supabase service role key, so row-level security policies are not required for this server-side insert path.
