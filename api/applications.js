import { careerPositions } from '../careers-data.js';

export const config = {
    runtime: 'edge'
};

export const ALLOWED_RESUME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const BUCKET_NAME = 'career-resumes';
const MIN_SUBMISSION_MS = 2500;
const MAX_SUBMISSION_MS = 2 * 60 * 60 * 1000;
const UPLOAD_EXPIRY_MS = 2 * 60 * 60 * 1000;
const DUPLICATE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const IP_RATE_WINDOW_MS = 10 * 60 * 1000;
const IP_RATE_LIMIT = 3;
const CLEANUP_BATCH_SIZE = 10;
const DEFAULT_TURNSTILE_HOSTNAMES = ['www.rhos.ai', 'rhos.ai'];
const positions = new Map(careerPositions.map((position) => [position.slug, position.title]));

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
        }
    });
}

function requireEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
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

function sanitizeFileName(name) {
    return String(name)
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 120);
}

function encodeObjectPath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}

function getExtension(name) {
    const match = String(name || '').toLowerCase().match(/\.(pdf|docx?)$/);
    return match?.[1] || '';
}

function expectedTypeForExtension(extension) {
    return {
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }[extension] || '';
}

function getClientIp(request) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    return forwardedFor?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || request.headers.get('cf-connecting-ip')
        || '';
}

function getAllowedTurnstileHostnames(value) {
    const configured = String(value || '')
        .split(',')
        .map((hostname) => hostname.trim().toLowerCase())
        .filter(Boolean);
    return configured.length ? configured : DEFAULT_TURNSTILE_HOSTNAMES;
}

export function isAllowedRequestOrigin(request) {
    const origin = request.headers.get('origin');
    if (!origin) return false;

    try {
        const originUrl = new URL(origin);
        const requestUrl = new URL(request.url);
        const local = ['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname);
        const validProtocol = originUrl.protocol === 'https:' || (local && originUrl.protocol === 'http:');
        return validProtocol && originUrl.host === requestUrl.host;
    } catch {
        return false;
    }
}

export function validatePreparePayload(payload, now = Date.now()) {
    const jobSlug = String(payload?.jobSlug || '').trim();
    const name = String(payload?.name || '').trim();
    const email = normalizeEmail(payload?.email);
    const phone = String(payload?.phone || '').trim();
    const profileUrl = String(payload?.profileUrl || '').trim();
    const notes = String(payload?.notes || '').trim();
    const resume = payload?.resume;

    if (!positions.has(jobSlug)) return 'invalid_position';
    if (String(payload?.companyWebsite || '').trim()) return 'invalid_request';
    if (payload?.consent !== true) return 'consent_required';
    if (!name || !email || !phone) return 'missing_fields';
    if (name.length > 120) return 'invalid_name';
    if (email.length > 254 || !isValidEmail(email)) return 'invalid_email';
    if (phone.length > 40) return 'invalid_phone';
    if (profileUrl.length > 300 || !isValidHttpUrl(profileUrl)) return 'invalid_profile_url';
    if (notes.length > 2000) return 'invalid_notes';

    const submittedAfterMs = now - Number(payload?.formStartedAt || 0);
    if (!Number.isFinite(submittedAfterMs)
        || submittedAfterMs < MIN_SUBMISSION_MS
        || submittedAfterMs > MAX_SUBMISSION_MS) {
        return 'invalid_request';
    }

    if (!resume || typeof resume.name !== 'string') return 'resume_required';
    if (!ALLOWED_RESUME_TYPES.has(resume.type)) return 'invalid_resume_type';
    if (!Number.isSafeInteger(resume.size) || resume.size <= 0) return 'invalid_resume_size';
    if (resume.size > MAX_RESUME_BYTES) return 'resume_too_large';
    if (!resume.name || resume.name.length > 150) return 'invalid_resume_name';
    if (expectedTypeForExtension(getExtension(resume.name)) !== resume.type) return 'resume_type_mismatch';
    return '';
}

function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(new Uint8Array(digest));
}

export function constantTimeEqual(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    const length = Math.max(a.length, b.length);
    let difference = a.length ^ b.length;
    for (let index = 0; index < length; index += 1) {
        difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
    }
    return difference === 0;
}

function startsWithBytes(bytes, signature) {
    return signature.every((byte, index) => bytes[index] === byte);
}

function readUint16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
    return (bytes[offset]
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24)) >>> 0;
}

function getZipEntryNames(bytes) {
    const minimumEocdOffset = Math.max(0, bytes.length - 65557);
    let eocdOffset = -1;
    for (let offset = bytes.length - 22; offset >= minimumEocdOffset; offset -= 1) {
        if (readUint32(bytes, offset) === 0x06054b50) {
            eocdOffset = offset;
            break;
        }
    }
    if (eocdOffset < 0) return [];

    const entryCount = readUint16(bytes, eocdOffset + 10);
    let offset = readUint32(bytes, eocdOffset + 16);
    const names = [];
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > bytes.length || readUint32(bytes, offset) !== 0x02014b50) return [];
        const nameLength = readUint16(bytes, offset + 28);
        const extraLength = readUint16(bytes, offset + 30);
        const commentLength = readUint16(bytes, offset + 32);
        const nameStart = offset + 46;
        const nameEnd = nameStart + nameLength;
        if (nameEnd > bytes.length) return [];
        names.push(new TextDecoder().decode(bytes.slice(nameStart, nameEnd)));
        offset = nameEnd + extraLength + commentLength;
    }
    return names;
}

export function validateResumeContents({ bytes, name, type, declaredSize }) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const extension = getExtension(name);
    if (!data.length || data.byteLength !== declaredSize) return 'resume_size_mismatch';
    if (expectedTypeForExtension(extension) !== type) return 'resume_type_mismatch';

    if (extension === 'pdf') {
        return startsWithBytes(data, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? '' : 'invalid_resume_content';
    }
    if (extension === 'doc') {
        const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
        return startsWithBytes(data, signature) ? '' : 'invalid_resume_content';
    }
    if (extension === 'docx') {
        if (!startsWithBytes(data, [0x50, 0x4b, 0x03, 0x04])) return 'invalid_resume_content';
        const entries = getZipEntryNames(data);
        const validDocx = entries.includes('[Content_Types].xml')
            && entries.some((entry) => entry.startsWith('word/'));
        return validDocx ? '' : 'invalid_resume_content';
    }
    return 'invalid_resume_type';
}

export function validateTurnstileResult(result, allowedHostnames) {
    return result?.success === true
        && result.action === 'career_application'
        && allowedHostnames.includes(String(result.hostname || '').toLowerCase());
}

async function supabaseRequest({ supabaseUrl, serviceKey, path, method = 'GET', body, headers = {} }) {
    const response = await fetch(`${supabaseUrl}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            ...headers
        },
        body
    });
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Supabase request failed (${response.status}): ${details}`);
    }
    return response;
}

async function selectApplications({ supabaseUrl, serviceKey, select, params }) {
    const query = new URLSearchParams({ select, ...params });
    const response = await supabaseRequest({
        supabaseUrl,
        serviceKey,
        path: `/rest/v1/career_applications?${query}`
    });
    return response.json();
}

async function insertApplication({ supabaseUrl, serviceKey, application }) {
    const response = await supabaseRequest({
        supabaseUrl,
        serviceKey,
        path: '/rest/v1/career_applications',
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            prefer: 'return=representation'
        },
        body: JSON.stringify(application)
    });
    return (await response.json())[0];
}

async function patchApplications({ supabaseUrl, serviceKey, params, changes, returnRows = false }) {
    const query = new URLSearchParams(params);
    const response = await supabaseRequest({
        supabaseUrl,
        serviceKey,
        path: `/rest/v1/career_applications?${query}`,
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            prefer: returnRows ? 'return=representation' : 'return=minimal'
        },
        body: JSON.stringify(changes)
    });
    return returnRows ? response.json() : [];
}

async function deleteApplication({ supabaseUrl, serviceKey, id }) {
    const query = new URLSearchParams({ id: `eq.${id}` });
    await supabaseRequest({
        supabaseUrl,
        serviceKey,
        path: `/rest/v1/career_applications?${query}`,
        method: 'DELETE'
    });
}

async function deleteResume({ supabaseUrl, serviceKey, filePath }) {
    await supabaseRequest({
        supabaseUrl,
        serviceKey,
        path: `/storage/v1/object/${BUCKET_NAME}`,
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [filePath] })
    });
}

async function createSignedUploadUrl({ supabaseUrl, serviceKey, filePath }) {
    const response = await supabaseRequest({
        supabaseUrl,
        serviceKey,
        path: `/storage/v1/object/upload/sign/${BUCKET_NAME}/${encodeObjectPath(filePath)}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
    });
    const payload = await response.json();
    const signedPath = payload.signedURL || payload.signedUrl || payload.url;
    if (!signedPath) throw new Error('Supabase did not return a signed upload URL.');
    if (/^https:\/\//i.test(signedPath)) return signedPath;
    return `${supabaseUrl}/storage/v1${signedPath.startsWith('/') ? signedPath : `/${signedPath}`}`;
}

async function createSignedResumeUrl({ supabaseUrl, serviceKey, filePath }) {
    const response = await supabaseRequest({
        supabaseUrl,
        serviceKey,
        path: `/storage/v1/object/sign/${BUCKET_NAME}/${encodeObjectPath(filePath)}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 30 })
    });
    const payload = await response.json();
    const signedPath = payload.signedURL || payload.signedUrl;
    if (!signedPath) throw new Error('Supabase did not return a signed download URL.');
    return `${supabaseUrl}/storage/v1${signedPath.startsWith('/') ? signedPath : `/${signedPath}`}`;
}

async function downloadResume({ supabaseUrl, serviceKey, filePath }) {
    const response = await supabaseRequest({
        supabaseUrl,
        serviceKey,
        path: `/storage/v1/object/authenticated/${BUCKET_NAME}/${encodeObjectPath(filePath)}`
    });
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_RESUME_BYTES) return new Uint8Array(MAX_RESUME_BYTES + 1);
    if (!response.body) return new Uint8Array(await response.arrayBuffer());

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESUME_BYTES) {
            await reader.cancel();
            return new Uint8Array(MAX_RESUME_BYTES + 1);
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

async function verifyTurnstile({ secret, token, ip, allowedHostnames }) {
    if (!token) return false;
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!response.ok) return false;
    const result = await response.json().catch(() => ({}));
    return validateTurnstileResult(result, allowedHostnames);
}

async function enforceSubmissionLimits({ supabaseUrl, serviceKey, jobSlug, email, requestIpHash }) {
    const duplicateSince = new Date(Date.now() - DUPLICATE_COOLDOWN_MS).toISOString();
    const duplicate = await selectApplications({
        supabaseUrl,
        serviceKey,
        select: 'id',
        params: {
            email: `eq.${email}`,
            job_slug: `eq.${jobSlug}`,
            created_at: `gte.${duplicateSince}`,
            status: 'in.(upload_pending,new,email_failed)',
            limit: '1'
        }
    });
    if (duplicate.length) return 'duplicate_submission';
    if (!requestIpHash) return '';

    const rateSince = new Date(Date.now() - IP_RATE_WINDOW_MS).toISOString();
    const recentFromIp = await selectApplications({
        supabaseUrl,
        serviceKey,
        select: 'id',
        params: {
            request_ip_hash: `eq.${requestIpHash}`,
            created_at: `gte.${rateSince}`,
            limit: String(IP_RATE_LIMIT)
        }
    });
    return recentFromIp.length >= IP_RATE_LIMIT ? 'rate_limited' : '';
}

async function cleanupExpiredApplications({ supabaseUrl, serviceKey }) {
    const expired = await selectApplications({
        supabaseUrl,
        serviceKey,
        select: 'id,resume_path',
        params: {
            status: 'eq.upload_pending',
            upload_expires_at: `lt.${new Date().toISOString()}`,
            limit: String(CLEANUP_BATCH_SIZE)
        }
    });
    for (const row of expired) {
        await deleteResume({ supabaseUrl, serviceKey, filePath: row.resume_path }).catch(() => {});
        await deleteApplication({ supabaseUrl, serviceKey, id: row.id });
    }
}

function createRandomToken(byteLength = 32) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function sendHrEmail({ resendKey, fromEmail, toEmail, application, resumeUrl }) {
    const safe = {
        jobTitle: escapeHtml(application.job_title),
        name: escapeHtml(application.name),
        email: escapeHtml(application.email),
        phone: escapeHtml(application.phone),
        profileUrl: escapeHtml(application.profile_url || 'N/A'),
        notes: escapeHtml(application.notes || 'N/A'),
        resumeUrl: escapeHtml(resumeUrl)
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
                <p><strong>Position:</strong> ${safe.jobTitle}</p>
                <p><strong>Name:</strong> ${safe.name}</p>
                <p><strong>Email:</strong> ${safe.email}</p>
                <p><strong>Phone:</strong> ${safe.phone}</p>
                <p><strong>Profile:</strong> ${safe.profileUrl}</p>
                <p><strong>Notes:</strong><br>${safe.notes}</p>
                <p><strong>Resume:</strong> <a href="${safe.resumeUrl}">Download resume</a> (expires in 30 days)</p>
            `
        })
    });
    if (!response.ok) throw new Error(`Resend request failed (${response.status}).`);
}

async function prepareApplication(request, payload) {
    const validationError = validatePreparePayload(payload);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    const supabaseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const turnstileSecret = requireEnv('TURNSTILE_SECRET_KEY');
    const ipHashSalt = requireEnv('IP_HASH_SALT');
    const requestIp = getClientIp(request);
    const requestIpHash = await sha256(`${ipHashSalt}:${requestIp || `unknown:${crypto.randomUUID()}`}`);
    const allowedHostnames = getAllowedTurnstileHostnames(process.env.TURNSTILE_ALLOWED_HOSTNAMES);

    const turnstileOk = await verifyTurnstile({
        secret: turnstileSecret,
        token: String(payload.turnstileToken || ''),
        ip: requestIp,
        allowedHostnames
    });
    if (!turnstileOk) return jsonResponse({ error: 'verification_failed' }, 400);

    await cleanupExpiredApplications({ supabaseUrl, serviceKey }).catch((error) => {
        console.error('Expired application cleanup failed', error);
    });

    const jobSlug = String(payload.jobSlug).trim();
    const email = normalizeEmail(payload.email);
    const limitError = await enforceSubmissionLimits({
        supabaseUrl,
        serviceKey,
        jobSlug,
        email,
        requestIpHash: requestIp ? requestIpHash : ''
    });
    if (limitError) return jsonResponse({ error: limitError }, 429);

    const finalizationToken = createRandomToken();
    const finalizationTokenHash = await sha256(finalizationToken);
    const resume = payload.resume;
    const filePath = `${jobSlug}/${crypto.randomUUID()}-${sanitizeFileName(resume.name)}`;
    const uploadExpiresAt = new Date(Date.now() + UPLOAD_EXPIRY_MS).toISOString();
    const application = await insertApplication({
        supabaseUrl,
        serviceKey,
        application: {
            job_slug: jobSlug,
            job_title: positions.get(jobSlug),
            name: String(payload.name).trim(),
            email,
            phone: String(payload.phone).trim(),
            profile_url: String(payload.profileUrl || '').trim() || null,
            notes: String(payload.notes || '').trim() || null,
            resume_path: filePath,
            resume_url: null,
            resume_name: resume.name,
            resume_type: resume.type,
            resume_size: resume.size,
            request_ip_hash: requestIpHash,
            consent_at: new Date().toISOString(),
            finalize_token_hash: finalizationTokenHash,
            upload_expires_at: uploadExpiresAt,
            status: 'upload_pending'
        }
    });

    try {
        const uploadUrl = await createSignedUploadUrl({ supabaseUrl, serviceKey, filePath });
        return jsonResponse({
            ok: true,
            applicationId: application.id,
            finalizeToken: finalizationToken,
            uploadUrl,
            expiresAt: uploadExpiresAt
        });
    } catch (error) {
        await deleteApplication({ supabaseUrl, serviceKey, id: application.id }).catch(() => {});
        throw error;
    }
}

async function finalizeApplication(payload) {
    const applicationId = String(payload?.applicationId || '').trim();
    const finalizationToken = String(payload?.finalizeToken || '').trim();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(applicationId) || !/^[0-9a-f]{64}$/i.test(finalizationToken)) {
        return jsonResponse({ error: 'invalid_request' }, 400);
    }

    const supabaseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const rows = await selectApplications({
        supabaseUrl,
        serviceKey,
        select: 'id,job_slug,job_title,name,email,phone,profile_url,notes,resume_path,resume_name,resume_type,resume_size,status,finalize_token_hash,upload_expires_at',
        params: { id: `eq.${applicationId}`, limit: '1' }
    });
    const application = rows[0];
    if (!application) return jsonResponse({ error: 'application_not_found' }, 404);
    if (['new', 'email_failed'].includes(application.status)) return jsonResponse({ ok: true, id: application.id });
    if (application.status !== 'upload_pending') return jsonResponse({ error: 'invalid_application_state' }, 409);
    if (new Date(application.upload_expires_at).getTime() <= Date.now()) {
        await deleteResume({ supabaseUrl, serviceKey, filePath: application.resume_path }).catch(() => {});
        await deleteApplication({ supabaseUrl, serviceKey, id: application.id }).catch(() => {});
        return jsonResponse({ error: 'upload_expired' }, 410);
    }

    const providedHash = await sha256(finalizationToken);
    if (!constantTimeEqual(providedHash, application.finalize_token_hash)) {
        return jsonResponse({ error: 'invalid_finalize_token' }, 403);
    }

    const bytes = await downloadResume({ supabaseUrl, serviceKey, filePath: application.resume_path });
    const contentError = validateResumeContents({
        bytes,
        name: application.resume_name,
        type: application.resume_type,
        declaredSize: application.resume_size
    });
    if (contentError) {
        await deleteResume({ supabaseUrl, serviceKey, filePath: application.resume_path }).catch(() => {});
        await patchApplications({
            supabaseUrl,
            serviceKey,
            params: { id: `eq.${application.id}`, status: 'eq.upload_pending' },
            changes: {
                status: 'rejected',
                finalize_token_hash: null,
                upload_expires_at: null
            }
        });
        return jsonResponse({ error: contentError }, 400);
    }

    const resumeUrl = await createSignedResumeUrl({
        supabaseUrl,
        serviceKey,
        filePath: application.resume_path
    });
    const claimedRows = await patchApplications({
        supabaseUrl,
        serviceKey,
        params: {
            id: `eq.${application.id}`,
            status: 'eq.upload_pending',
            finalize_token_hash: `eq.${application.finalize_token_hash}`
        },
        changes: {
            status: 'new',
            finalize_token_hash: null,
            upload_expires_at: null
        },
        returnRows: true
    });
    if (!claimedRows.length) return jsonResponse({ ok: true, id: application.id });

    try {
        await sendHrEmail({
            resendKey: requireEnv('RESEND_API_KEY'),
            fromEmail: requireEnv('APPLICATION_FROM_EMAIL'),
            toEmail: process.env.HR_NOTIFY_EMAIL || 'hr@rhos.ai',
            application,
            resumeUrl
        });
    } catch (error) {
        console.error('HR email failed after application finalization', error);
        await patchApplications({
            supabaseUrl,
            serviceKey,
            params: { id: `eq.${application.id}`, status: 'eq.new' },
            changes: { status: 'email_failed' }
        }).catch((statusError) => console.error('Failed to mark email failure', statusError));
    }
    return jsonResponse({ ok: true, id: application.id });
}

export default async function handler(request) {
    if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
    if (!isAllowedRequestOrigin(request)) return jsonResponse({ error: 'invalid_origin' }, 403);

    try {
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/json')) {
            return jsonResponse({ error: 'invalid_content_type' }, 415);
        }
        const payload = await request.json();
        if (payload?.action === 'prepare') return prepareApplication(request, payload);
        if (payload?.action === 'finalize') return finalizeApplication(payload);
        return jsonResponse({ error: 'invalid_action' }, 400);
    } catch (error) {
        console.error('Application request failed', error);
        return jsonResponse({ error: 'application_request_failed' }, 500);
    }
}
