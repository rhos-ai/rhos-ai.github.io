export const config = {
    runtime: 'edge'
};

const allowedTypes = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const maxResumeBytes = 10 * 1024 * 1024;
const bucketName = 'career-resumes';
const minSubmissionMs = 2500;
const maxSubmissionMs = 2 * 60 * 60 * 1000;
const duplicateCooldownMs = 24 * 60 * 60 * 1000;
const ipRateWindowMs = 10 * 60 * 1000;
const ipRateLimit = 3;

const positions = new Map([
    ['model-algorithm-engineer-world-model', 'Model Algorithm Engineer — World Model Direction'],
    ['data-algorithm-engineer-human-video', 'Data Algorithm Engineer — Embodied Intelligence Human Video Direction'],
    ['motion-control-engineer', 'Motion Control Engineer'],
    ['robotic-arm-gripper-hardware-engineer', 'Robotic Arm / Gripper Hardware Engineer']
]);

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8'
        }
    });
}

function requireEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
}

function sanitizeFileName(name) {
    return name
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 120);
}

function encodeObjectPath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}

function getString(formData, key) {
    return String(formData.get(key) || '').trim();
}

function normalizeEmail(email) {
    return email.toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidHttpUrl(value) {
    if (!value) return true;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function getClientIp(request) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || request.headers.get('cf-connecting-ip')
        || '';
    return ip.slice(0, 64);
}

function getUserAgent(request) {
    return String(request.headers.get('user-agent') || '').slice(0, 500);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function validatePayload({ jobSlug, name, email, phone, profileUrl, notes, resume, honeypot, formStartedAt }) {
    if (!positions.has(jobSlug)) return 'Invalid position.';
    if (honeypot) return 'Submission failed. Please try again later.';
    if (!name || !email || !phone) return 'Missing required fields.';
    if (name.length > 120) return 'Name is too long.';
    if (email.length > 254 || !isValidEmail(email)) return 'Invalid email address.';
    if (phone.length > 40) return 'Phone number is too long.';
    if (profileUrl.length > 300 || !isValidHttpUrl(profileUrl)) return 'Invalid profile URL.';
    if (notes.length > 2000) return 'Additional information is too long.';
    const submittedAfterMs = Date.now() - Number(formStartedAt || 0);
    if (!Number.isFinite(submittedAfterMs) || submittedAfterMs < minSubmissionMs || submittedAfterMs > maxSubmissionMs) {
        return 'Submission failed. Please try again later.';
    }
    if (!resume || typeof resume.name !== 'string') return 'Resume is required.';
    if (!allowedTypes.has(resume.type)) return 'Unsupported resume file type.';
    if (resume.size > maxResumeBytes) return 'Resume exceeds 10MB.';
    if (resume.name.length > 150) return 'Resume filename is too long.';
    return '';
}

async function selectApplications({ supabaseUrl, serviceKey, params }) {
    const query = new URLSearchParams({ select: 'id', ...params });
    const response = await fetch(`${supabaseUrl}/rest/v1/career_applications?${query.toString()}`, {
        headers: {
            authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey
        }
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Application lookup failed: ${details}`);
    }

    return response.json();
}

async function enforceSubmissionLimits({ supabaseUrl, serviceKey, jobSlug, email, requestIp }) {
    const duplicateSince = new Date(Date.now() - duplicateCooldownMs).toISOString();
    const recentDuplicate = await selectApplications({
        supabaseUrl,
        serviceKey,
        params: {
            email: `eq.${email}`,
            job_slug: `eq.${jobSlug}`,
            created_at: `gte.${duplicateSince}`,
            limit: '1'
        }
    });

    if (recentDuplicate.length > 0) {
        return 'You have already submitted this role recently.';
    }

    if (!requestIp) return '';

    const rateSince = new Date(Date.now() - ipRateWindowMs).toISOString();
    const recentFromIp = await selectApplications({
        supabaseUrl,
        serviceKey,
        params: {
            request_ip: `eq.${requestIp}`,
            created_at: `gte.${rateSince}`,
            limit: String(ipRateLimit)
        }
    });

    if (recentFromIp.length >= ipRateLimit) {
        return 'Too many submissions. Please try again later.';
    }

    return '';
}

async function verifyTurnstile({ secret, token, ip }) {
    if (!token) return false;

    const body = new URLSearchParams({
        secret,
        response: token
    });
    if (ip) body.set('remoteip', ip);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded'
        },
        body
    });

    if (!response.ok) return false;
    const result = await response.json().catch(() => ({}));
    return result.success === true;
}

async function uploadResume({ supabaseUrl, serviceKey, filePath, resume }) {
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucketName}/${encodeObjectPath(filePath)}`;
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'content-type': resume.type,
            'x-upsert': 'false'
        },
        body: await resume.arrayBuffer()
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Resume upload failed: ${details}`);
    }
}

async function createSignedResumeUrl({ supabaseUrl, serviceKey, filePath }) {
    const signUrl = `${supabaseUrl}/storage/v1/object/sign/${bucketName}/${encodeObjectPath(filePath)}`;
    const response = await fetch(signUrl, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'content-type': 'application/json'
        },
        body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 30 })
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Resume signing failed: ${details}`);
    }

    const payload = await response.json();
    return `${supabaseUrl}/storage/v1${payload.signedURL}`;
}

async function insertApplication({ supabaseUrl, serviceKey, application }) {
    const response = await fetch(`${supabaseUrl}/rest/v1/career_applications`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'content-type': 'application/json',
            prefer: 'return=representation'
        },
        body: JSON.stringify(application)
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Application insert failed: ${details}`);
    }

    const rows = await response.json();
    return rows[0];
}

async function sendHrEmail({ resendKey, fromEmail, toEmail, application }) {
    const safeApplication = {
        job_title: escapeHtml(application.job_title),
        name: escapeHtml(application.name),
        email: escapeHtml(application.email),
        phone: escapeHtml(application.phone),
        profile_url: escapeHtml(application.profile_url || 'N/A'),
        notes: escapeHtml(application.notes || 'N/A'),
        resume_url: escapeHtml(application.resume_url)
    };
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${resendKey}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            from: fromEmail,
            to: [toEmail],
            reply_to: application.email,
            subject: `New application: ${application.job_title} - ${application.name}`,
            html: `
                <h2>New career application</h2>
                <p><strong>Position:</strong> ${safeApplication.job_title}</p>
                <p><strong>Name:</strong> ${safeApplication.name}</p>
                <p><strong>Email:</strong> ${safeApplication.email}</p>
                <p><strong>Phone:</strong> ${safeApplication.phone}</p>
                <p><strong>Profile:</strong> ${safeApplication.profile_url}</p>
                <p><strong>Notes:</strong><br>${safeApplication.notes}</p>
                <p><strong>Resume:</strong> <a href="${safeApplication.resume_url}">Download resume</a></p>
            `
        })
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`HR email failed: ${details}`);
    }
}

export default async function handler(request) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed.' }, 405);
    }

    try {
        const supabaseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
        const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
        const resendKey = requireEnv('RESEND_API_KEY');
        const fromEmail = requireEnv('APPLICATION_FROM_EMAIL');
        const turnstileSecret = requireEnv('TURNSTILE_SECRET_KEY');
        const hrEmail = process.env.HR_NOTIFY_EMAIL || 'hr@rhos.ai';
        const formData = await request.formData();
        const resume = formData.get('resume');
        const jobSlug = getString(formData, 'jobSlug');
        const name = getString(formData, 'name');
        const email = normalizeEmail(getString(formData, 'email'));
        const phone = getString(formData, 'phone');
        const profileUrl = getString(formData, 'profileUrl');
        const notes = getString(formData, 'notes');
        const requestIp = getClientIp(request);
        const userAgent = getUserAgent(request);
        const validationError = validatePayload({
            jobSlug,
            name,
            email,
            phone,
            profileUrl,
            notes,
            resume,
            honeypot: getString(formData, 'companyWebsite'),
            formStartedAt: getString(formData, 'formStartedAt')
        });

        if (validationError) return jsonResponse({ error: validationError }, 400);

        const turnstileOk = await verifyTurnstile({
            secret: turnstileSecret,
            token: getString(formData, 'cf-turnstile-response'),
            ip: requestIp
        });

        if (!turnstileOk) {
            return jsonResponse({ error: 'Verification failed. Please try again.' }, 400);
        }

        const submissionLimitError = await enforceSubmissionLimits({
            supabaseUrl,
            serviceKey,
            jobSlug,
            email,
            requestIp
        });

        if (submissionLimitError) return jsonResponse({ error: submissionLimitError }, 429);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = `${jobSlug}/${timestamp}-${sanitizeFileName(resume.name)}`;
        await uploadResume({ supabaseUrl, serviceKey, filePath, resume });
        const resumeUrl = await createSignedResumeUrl({ supabaseUrl, serviceKey, filePath });

        const application = {
            job_slug: jobSlug,
            job_title: positions.get(jobSlug),
            name,
            email,
            phone,
            profile_url: profileUrl || null,
            notes: notes || null,
            resume_path: filePath,
            resume_url: resumeUrl,
            request_ip: requestIp || null,
            user_agent: userAgent || null,
            status: 'new'
        };

        const savedApplication = await insertApplication({ supabaseUrl, serviceKey, application });
        await sendHrEmail({
            resendKey,
            fromEmail,
            toEmail: hrEmail,
            application
        });

        return jsonResponse({ ok: true, id: savedApplication?.id || null });
    } catch (error) {
        return jsonResponse({ error: error.message || 'Application submission failed.' }, 500);
    }
}
