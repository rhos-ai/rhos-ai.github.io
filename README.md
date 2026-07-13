# RhOS Website

Static website for RhOS, including the homepage, research index, research project pages, careers pages, and a Vercel API for careers applications.

## Project Structure

```text
.
├── index.html                         # Homepage
├── about.html                         # Draft company overview, not linked in production navigation
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
IP_HASH_SALT
TURNSTILE_ALLOWED_HOSTNAMES
HR_NOTIFY_EMAIL
```

Notes:

- `SUPABASE_URL` should be the project root URL, for example `https://xxxx.supabase.co`.
- Do not include `/rest/v1/` in `SUPABASE_URL`.
- `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, and `IP_HASH_SALT` must never be committed.
- `APPLICATION_FROM_EMAIL` must use a domain verified in Resend, for example `RhOS Careers <careers@rhos.ai>`.
- `TURNSTILE_ALLOWED_HOSTNAMES` is optional and defaults to `www.rhos.ai,rhos.ai`; add intended preview domains when testing there.
- `HR_NOTIFY_EMAIL` defaults to `hr@rhos.ai` if omitted.

## Careers Application Backend

The application modal uses two JSON actions at:

```text
/api/applications
```

The application flow:

- Verifies Cloudflare Turnstile hostname and `career_application` action
- Validates metadata and creates an expiring pending application
- Hashes the client IP with `IP_HASH_SALT` for rate limiting without storing the raw address
- Returns a two-hour signed URL so the browser uploads directly to private Supabase Storage
- Downloads and validates the stored PDF, DOC, or DOCX signature before activation
- Sends an HR notification through Resend with a 30-day signed resume link
- Sets `reply_to` to the applicant email so HR can reply directly

If the application is saved but the HR email fails, the API still returns success and marks the row:

```text
status = email_failed
```

## Supabase Setup

Create a private Storage bucket with a 10MB limit and the three allowed resume MIME types:

```text
career-resumes
```

Run the complete new-table or migration SQL, including RLS and least-privilege grants, from [docs/careers-application-setup.md](docs/careers-application-setup.md).

## Security Notes

Current baseline protections include:

- Cloudflare Turnstile hostname and action validation
- Honeypot bot field
- Minimum form-fill time
- Server-side role whitelist
- Server-side validation and length limits
- Server-side PDF/DOC/DOCX signature validation after upload
- 10MB resume limit
- Private Supabase Storage bucket
- One-time signed upload URLs and expiring resume download URLs
- Email and salted IP-hash submission throttling
- HTML escaping in HR notification emails
- Generic API errors for server failures
- Site-wide security headers through Vercel

## Validation

Before pushing changes, run:

```bash
npm run check
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
