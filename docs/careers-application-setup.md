# Careers Application Setup

The careers application form posts to `/api/applications`.

## Required Vercel environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `APPLICATION_FROM_EMAIL`
- `TURNSTILE_SECRET_KEY`
- `HR_NOTIFY_EMAIL` optional, defaults to `hr@rhos.ai`

`APPLICATION_FROM_EMAIL` must be a sender verified in Resend.

`TURNSTILE_SECRET_KEY` is the private Cloudflare Turnstile secret key. The public site key is embedded in `careers.js`.

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
  request_ip text,
  user_agent text,
  status text not null default 'new'
);
```

If the table already exists, run this migration:

```sql
alter table career_applications
  add column if not exists request_ip text,
  add column if not exists user_agent text;

create index if not exists career_applications_email_job_created_idx
  on career_applications (email, job_slug, created_at desc);

create index if not exists career_applications_request_ip_created_idx
  on career_applications (request_ip, created_at desc);
```

## Abuse protection

The API includes these baseline protections:

- server-side role whitelist
- Cloudflare Turnstile verification
- honeypot bot field
- minimum form-fill time
- required field and length validation
- PDF/DOC/DOCX only, 10MB max
- one application per email per role per 24 hours
- three applications per IP per 10 minutes

The API uses the Supabase service role key, so row-level security policies are not required for this server-side insert path.
