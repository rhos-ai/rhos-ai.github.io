# RHOS Website Hardening Design

## Goal

Resolve the confirmed recruiting, security, deployment, accessibility, and regression risks without changing the site's visual direction or public information architecture.

## Scope

This change covers:

- Direct-to-Supabase resume uploads while preserving the 10MB limit.
- Server-side validation of uploaded file contents before an application becomes active.
- Supabase RLS and least-privilege setup documentation.
- Turnstile hostname and action validation.
- Application modal lifecycle, focus, and repeat-submission behavior.
- Removal of dead public controls and exclusion of the draft About page from Vercel output.
- Touch-target, keyboard-focus, and reduced-motion improvements.
- Automated API and static-site regression checks in GitHub Actions.

This change does not publish or push a deployment. Vercel production drift must be verified after the resulting branch is pushed and deployed.

## Application Architecture

The existing `/api/applications` endpoint will support two JSON actions.

### Prepare

The browser sends applicant metadata, resume metadata, consent, form timing, and the Turnstile token. The API:

1. Validates the request origin, role, fields, consent, file name, declared type, declared size, honeypot, and form timing.
2. Validates Turnstile `success`, `hostname`, and `action=career_application`.
3. Applies duplicate and IP-hash submission limits.
4. Creates a cryptographically random finalization token and stores only its SHA-256 hash.
5. Inserts an `upload_pending` application row with a two-hour expiry and a unique Storage path.
6. Requests a two-hour signed upload URL from the private `career-resumes` bucket.
7. Returns the signed upload URL, application ID, and one-time finalization token.

The raw client IP and user agent will no longer be stored. Rate limiting will use a salted SHA-256 IP hash through a required `IP_HASH_SALT` environment variable.

### Direct Upload

The browser uploads the resume with `PUT` directly to the Supabase signed upload URL. The service-role key and publishable key are never exposed. Upload progress is reflected in the existing form status message.

### Finalize

After upload, the browser sends the application ID and finalization token to `/api/applications`. The API:

1. Loads the matching `upload_pending` row and verifies the one-time token and expiry.
2. Downloads the private object server-side and verifies exact size, extension/type agreement, and file signature.
3. Accepts PDF, legacy DOC, and DOCX only. DOCX must be a ZIP container containing both `[Content_Types].xml` and a `word/` entry.
4. Deletes the object and rejects the pending row when validation fails.
5. Generates a 30-day signed download URL for the HR email only; the expiring URL is not treated as durable database data.
6. Marks the row `new`, clears the finalization token, and sends the HR notification.
7. Marks the row `email_failed` if Resend fails while still returning a successful application response.

Pending rows are eligible for opportunistic cleanup after their two-hour expiry. Each new prepare request will clean a small bounded batch of expired rows and their objects so abandoned uploads do not accumulate without bound.

## Database and Storage Security

The setup SQL will:

- Enable RLS on `public.career_applications`.
- Revoke table privileges from `anon` and `authenticated`.
- Preserve service-role access for the server-side API.
- Add `resume_name`, `resume_type`, `resume_size`, `request_ip_hash`, `consent_at`, `finalize_token_hash`, and `upload_expires_at`.
- Make `resume_url` nullable for compatibility and stop persisting newly generated signed URLs.
- Add indexes used by duplicate, IP-hash, pending-lookup, and cleanup queries.

The `career-resumes` bucket remains private and should enforce a 10MB object limit plus the three allowed MIME types in Supabase Dashboard settings.

## Client Behavior

The application modal will:

- Add a required English/Chinese recruitment-data consent checkbox.
- Reset Turnstile whenever the modal is closed or reopened.
- Refresh `formStartedAt` after a successful submission so another role can be submitted without reopening.
- Restore focus to the Apply button that opened the modal.
- Trap Tab focus inside the open dialog and keep Escape/backdrop close behavior.
- Present distinct validation, upload, finalization, and failure messages.
- Keep the current bilingual copy and visual treatment.

## Public Page and Deployment Rules

- Add `about.html` to `.vercelignore`; the draft remains local but is not included in future deployments.
- Remove the nonfunctional Research `Request Demo` anchor rather than inventing an unconfirmed contact destination.
- Replace `transition: all` and add visible keyboard focus styles.
- Increase mobile navigation, language, modal-close, and action controls to at least 44px touch targets.
- Keep the permissive CSP only where the proxied IPR-1 and GM-100 applications require inline execution. Core RHOS pages will receive a stricter route-specific policy without inline scripts.

Production currently serves an older commit than `main`. After deployment, verification must compare a known current marker in `index.html`, confirm the new logo asset returns 200, and inspect the Vercel deployment commit SHA.

## Testing

Use Node's built-in test runner with no browser framework dependency.

- API unit tests cover payload validation, Turnstile hostname/action checks, token hashing, constant-time token comparison, file signature validation, extension/type mismatches, and size limits.
- Static-site tests cover local resource resolution, required social metadata, absence of placeholder `href="#"`, About exclusion, valid Vercel JSON, and CSP routing.
- Syntax checks cover all JavaScript modules.
- A GitHub Actions workflow runs the complete test command on every push and pull request.
- Manual verification covers the bilingual modal, keyboard focus loop, Turnstile reset, direct upload, successful HR email, rejected spoofed file, mobile layout, and deployed route/assets.

## Failure Handling

- Prepare failures create no upload URL.
- Upload failures leave a bounded pending row that expires and is cleaned later.
- Invalid uploaded content is deleted before HR notification.
- Finalization is idempotent: an already finalized application returns success without sending a second HR email.
- Internal Supabase, Resend, and Turnstile details remain in server logs; public responses remain generic and localized by the client.

## Required Configuration Changes

Add these Vercel environment variables in Production and Preview:

- `IP_HASH_SALT`: a long random secret used only for rate-limit IP hashing.
- `TURNSTILE_ALLOWED_HOSTNAMES`: comma-separated hostnames, defaulting to `www.rhos.ai,rhos.ai` when omitted.

Existing variables remain required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `APPLICATION_FROM_EMAIL`, and `TURNSTILE_SECRET_KEY`.

