# Careers Application Setup

The careers form uses a two-step `/api/applications` flow. The API validates applicant metadata and returns a two-hour Supabase signed upload URL, the browser uploads the resume directly to private Storage, and the API then validates the stored file before notifying HR.

## Required Vercel environment variables

- `SUPABASE_URL`: project URL, for example `https://project-ref.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key
- `RESEND_API_KEY`
- `APPLICATION_FROM_EMAIL`: a sender verified by Resend
- `TURNSTILE_SECRET_KEY`: private Cloudflare Turnstile secret
- `IP_HASH_SALT`: a long random secret used to hash rate-limit identifiers
- `TURNSTILE_ALLOWED_HOSTNAMES`: optional comma-separated list; defaults to `www.rhos.ai,rhos.ai`
- `HR_NOTIFY_EMAIL`: optional; defaults to `hr@rhos.ai`

Add every production and preview hostname that should accept applications to `TURNSTILE_ALLOWED_HOSTNAMES`. Never expose the service role key, Turnstile secret, Resend key, or IP hash salt in client code.

## Supabase table

For a new project, run this in the Supabase SQL Editor:

```sql
create table public.career_applications (
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
  resume_url text,
  resume_name text not null,
  resume_type text not null,
  resume_size bigint not null check (resume_size > 0 and resume_size <= 10485760),
  request_ip_hash text not null,
  consent_at timestamptz not null,
  finalize_token_hash text,
  upload_expires_at timestamptz,
  status text not null default 'upload_pending'
);

alter table public.career_applications enable row level security;
revoke all on table public.career_applications from anon, authenticated;
grant all on table public.career_applications to service_role;

create index career_applications_email_job_created_idx
  on public.career_applications (email, job_slug, created_at desc);
create index career_applications_ip_hash_created_idx
  on public.career_applications (request_ip_hash, created_at desc);
create index career_applications_pending_token_idx
  on public.career_applications (id, finalize_token_hash)
  where status = 'upload_pending';
create index career_applications_pending_expiry_idx
  on public.career_applications (upload_expires_at)
  where status = 'upload_pending';
```

For the original RHOS table, run this migration instead:

```sql
alter table public.career_applications
  alter column resume_url drop not null,
  add column if not exists request_ip text,
  add column if not exists user_agent text,
  add column if not exists resume_name text,
  add column if not exists resume_type text,
  add column if not exists resume_size bigint,
  add column if not exists request_ip_hash text,
  add column if not exists consent_at timestamptz,
  add column if not exists finalize_token_hash text,
  add column if not exists upload_expires_at timestamptz;

alter table public.career_applications enable row level security;
revoke all on table public.career_applications from anon, authenticated;
grant all on table public.career_applications to service_role;

create index if not exists career_applications_email_job_created_idx
  on public.career_applications (email, job_slug, created_at desc);
create index if not exists career_applications_ip_hash_created_idx
  on public.career_applications (request_ip_hash, created_at desc);
create index if not exists career_applications_pending_token_idx
  on public.career_applications (id, finalize_token_hash)
  where status = 'upload_pending';
create index if not exists career_applications_pending_expiry_idx
  on public.career_applications (upload_expires_at)
  where status = 'upload_pending';

-- Raw IP and browser fingerprints are no longer used.
update public.career_applications set request_ip = null, user_agent = null
  where request_ip is not null or user_agent is not null;
```

The migration leaves the legacy `request_ip` and `user_agent` columns in place for compatibility but clears their values. They can be dropped later after confirming no external HR workflow depends on them.

## Supabase Storage

Create or update the private bucket named:

```text
career-resumes
```

In Storage bucket settings:

- Keep the bucket private.
- Set the maximum file size to `10 MB`.
- Allow only `application/pdf`, `application/msword`, and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

No public Storage policy is required. The server creates one-time signed upload URLs with the service role, and HR receives a signed download URL that expires after 30 days.

## Cloudflare Turnstile

Add `www.rhos.ai`, `rhos.ai`, and any intended Vercel preview domains to the Turnstile widget hostname allowlist. The API requires both the expected hostname and `action=career_application`; a successful generic Turnstile token is not sufficient.

## Application states

- `upload_pending`: metadata accepted; waiting for direct upload and finalization
- `new`: file validated and ready for HR review
- `email_failed`: application saved, but HR notification failed
- `rejected`: uploaded bytes did not match the declared PDF, DOC, or DOCX format

Each prepare request removes a bounded batch of abandoned pending uploads older than two hours. Filter `email_failed` in Supabase for manual follow-up.

## Deployment check

After changing environment variables or SQL, redeploy both Preview and Production. Test one valid PDF and one renamed non-PDF file. The valid application should become `new`; the spoofed file should be deleted and become `rejected` without an HR email.
