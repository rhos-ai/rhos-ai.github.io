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

function validatePayload({ jobSlug, name, email, phone, resume }) {
    if (!positions.has(jobSlug)) return 'Invalid position.';
    if (!name || !email || !phone) return 'Missing required fields.';
    if (!resume || typeof resume.name !== 'string') return 'Resume is required.';
    if (!allowedTypes.has(resume.type)) return 'Unsupported resume file type.';
    if (resume.size > maxResumeBytes) return 'Resume exceeds 10MB.';
    return '';
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
                <p><strong>Position:</strong> ${application.job_title}</p>
                <p><strong>Name:</strong> ${application.name}</p>
                <p><strong>Email:</strong> ${application.email}</p>
                <p><strong>Phone:</strong> ${application.phone}</p>
                <p><strong>Profile:</strong> ${application.profile_url || 'N/A'}</p>
                <p><strong>Notes:</strong><br>${application.notes || 'N/A'}</p>
                <p><strong>Resume:</strong> <a href="${application.resume_url}">Download resume</a></p>
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
        const hrEmail = process.env.HR_NOTIFY_EMAIL || 'hr@rhos.ai';
        const formData = await request.formData();
        const resume = formData.get('resume');
        const jobSlug = getString(formData, 'jobSlug');
        const validationError = validatePayload({
            jobSlug,
            name: getString(formData, 'name'),
            email: getString(formData, 'email'),
            phone: getString(formData, 'phone'),
            resume
        });

        if (validationError) return jsonResponse({ error: validationError }, 400);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = `${jobSlug}/${timestamp}-${sanitizeFileName(resume.name)}`;
        await uploadResume({ supabaseUrl, serviceKey, filePath, resume });
        const resumeUrl = await createSignedResumeUrl({ supabaseUrl, serviceKey, filePath });

        const application = {
            job_slug: jobSlug,
            job_title: positions.get(jobSlug),
            name: getString(formData, 'name'),
            email: getString(formData, 'email'),
            phone: getString(formData, 'phone'),
            profile_url: getString(formData, 'profileUrl') || null,
            notes: getString(formData, 'notes') || null,
            resume_path: filePath,
            resume_url: resumeUrl,
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
