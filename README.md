# RHOS Website

Static website for RHOS, including the homepage, research index, research project pages, careers pages, and a Vercel API for careers applications.

## Project Structure

```text
.
├── index.html                         # Homepage
├── research.html                      # Research index
├── research/                          # Research project pages and assets
├── careers.html                       # Careers openings index
├── careers/                           # Individual job pages
├── careers-data.js                    # Shared careers role metadata
├── careers.js                         # Careers language toggle and application modal
├── api/applications.js                # Vercel API for job applications
├── assets/                            # Shared static assets
├── docs/careers-application-setup.md  # Application backend setup notes
├── robots.txt                         # Search crawler directives
├── sitemap.xml                        # Canonical URL sitemap
├── style.css                          # Global site styles
└── vercel.json                        # Vercel rewrites and security headers
```

## Local Preview

This site can be previewed with a static file server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
http://localhost:8000/research.html
http://localhost:8000/careers.html
```

The careers API at `/api/applications` requires Vercel or another compatible serverless runtime. A plain Python static server will not run the API.

## Deployment

The project is intended to run on Vercel.

Recommended Vercel settings:

```text
Framework Preset: Other
Root Directory: .
Build Command: empty
Output Directory: empty or .
```

The `vercel.json` file configures:

- Clean routes for `/research` and `/careers`
- Research project rewrites
- Security headers, including HSTS, CSP, referrer policy, permissions policy, and frame protection

Search indexing files are served statically:

- `/robots.txt`
- `/sitemap.xml`

After changing environment variables, redeploy the active Production deployment.

## Required Environment Variables

Configure these in Vercel for `Production and Preview`:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
APPLICATION_FROM_EMAIL
TURNSTILE_SECRET_KEY
HR_NOTIFY_EMAIL
```

Notes:

- `SUPABASE_URL` should be the project root URL, for example `https://xxxx.supabase.co`.
- Do not include `/rest/v1/` in `SUPABASE_URL`.
- `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `TURNSTILE_SECRET_KEY` must never be committed.
- `APPLICATION_FROM_EMAIL` must use a domain verified in Resend, for example `RHOS Careers <careers@rhos.ai>`.
- `HR_NOTIFY_EMAIL` defaults to `hr@rhos.ai` if omitted.

## Careers Application Backend

The application modal posts `FormData` to:

```text
/api/applications
```

The API:

- Verifies Cloudflare Turnstile
- Validates the role, required fields, email, URL, file type, and file size
- Limits duplicate submissions by email and role
- Limits high-frequency submissions by IP
- Uploads resumes to Supabase Storage
- Inserts the application into Supabase Postgres
- Sends an HR notification email through Resend
- Sets `reply_to` to the applicant email so HR can reply directly

If the application is saved but the HR email fails, the API still returns success and marks the row:

```text
status = email_failed
```

## Supabase Setup

Create a private Storage bucket:

```text
career-resumes
```

Create the applications table:

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

For an existing table, run:

```sql
alter table career_applications
  add column if not exists request_ip text,
  add column if not exists user_agent text;

create index if not exists career_applications_email_job_created_idx
  on career_applications (email, job_slug, created_at desc);

create index if not exists career_applications_request_ip_created_idx
  on career_applications (request_ip, created_at desc);
```

## Security Notes

Current baseline protections include:

- Cloudflare Turnstile
- Honeypot bot field
- Minimum form-fill time
- Server-side role whitelist
- Server-side validation and length limits
- PDF/DOC/DOCX resume uploads only
- 10MB resume limit
- Private Supabase Storage bucket
- Signed resume download URLs
- Email and IP submission throttling
- HTML escaping in HR notification emails
- Generic API errors for server failures
- Site-wide security headers through Vercel

## Validation

Before pushing changes, run:

```bash
node --check careers.js
node --check careers-data.js
node --check api/applications.js
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"
git diff --check
```

For deployment validation, test:

- Homepage loads
- `/research` loads
- `/careers` loads
- Turnstile renders in the application modal
- A test application creates a Supabase row
- A resume is uploaded to `career-resumes`
- HR receives the Resend notification email
