import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MAX_RESUME_BYTES,
    constantTimeEqual,
    isAllowedRequestOrigin,
    sha256,
    validatePreparePayload,
    validateResumeContents,
    validateTurnstileResult
} from '../api/applications.js';

const pdfType = 'application/pdf';
const docType = 'application/msword';
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function validPayload(now = Date.now()) {
    return {
        jobSlug: 'motion-control-engineer',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: '+86 13800000000',
        profileUrl: 'https://example.com/ada',
        notes: 'Robot control experience.',
        resume: { name: 'ada-resume.pdf', type: pdfType, size: 128 },
        companyWebsite: '',
        formStartedAt: now - 5000,
        consent: true
    };
}

function zipWithEntries(entryNames) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;

    for (const entryName of entryNames) {
        const name = Buffer.from(entryName);
        const local = Buffer.alloc(30 + name.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(name.length, 26);
        name.copy(local, 30);
        localParts.push(local);

        const central = Buffer.alloc(46 + name.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(localOffset, 42);
        name.copy(central, 46);
        centralParts.push(central);
        localOffset += local.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entryNames.length, 8);
    eocd.writeUInt16LE(entryNames.length, 10);
    eocd.writeUInt32LE(centralDirectory.length, 12);
    eocd.writeUInt32LE(localOffset, 16);
    return Buffer.concat([...localParts, centralDirectory, eocd]);
}

test('prepare payload accepts a complete application', () => {
    const now = Date.now();
    assert.equal(validatePreparePayload(validPayload(now), now), '');
});

test('prepare payload requires consent and a credible form duration', () => {
    const now = Date.now();
    assert.equal(validatePreparePayload({ ...validPayload(now), consent: false }, now), 'consent_required');
    assert.equal(validatePreparePayload({ ...validPayload(now), formStartedAt: now - 100 }, now), 'invalid_request');
});

test('prepare payload enforces exact extension, MIME, and size agreement', () => {
    const now = Date.now();
    const mismatched = validPayload(now);
    mismatched.resume = { name: 'resume.docx', type: pdfType, size: 100 };
    assert.equal(validatePreparePayload(mismatched, now), 'resume_type_mismatch');

    const oversized = validPayload(now);
    oversized.resume.size = MAX_RESUME_BYTES + 1;
    assert.equal(validatePreparePayload(oversized, now), 'resume_too_large');
});

test('Turnstile result must bind success, hostname, and action', () => {
    const allowed = ['www.rhos.ai', 'rhos.ai'];
    assert.equal(validateTurnstileResult({
        success: true,
        hostname: 'www.rhos.ai',
        action: 'career_application'
    }, allowed), true);
    assert.equal(validateTurnstileResult({ success: true, hostname: 'evil.example', action: 'career_application' }, allowed), false);
    assert.equal(validateTurnstileResult({ success: true, hostname: 'www.rhos.ai', action: 'login' }, allowed), false);
});

test('request origin must match the request host', () => {
    assert.equal(isAllowedRequestOrigin(new Request('https://www.rhos.ai/api/applications', {
        headers: { origin: 'https://www.rhos.ai' }
    })), true);
    assert.equal(isAllowedRequestOrigin(new Request('https://www.rhos.ai/api/applications', {
        headers: { origin: 'https://example.com' }
    })), false);
    assert.equal(isAllowedRequestOrigin(new Request('http://localhost:8000/api/applications', {
        headers: { origin: 'http://localhost:8000' }
    })), true);
});

test('SHA-256 token hashes are stable and token comparison checks full values', async () => {
    const first = await sha256('one-time-token');
    const second = await sha256('one-time-token');
    assert.equal(first, second);
    assert.equal(first.length, 64);
    assert.equal(constantTimeEqual(first, second), true);
    assert.equal(constantTimeEqual(first, `${second.slice(0, -1)}0`), false);
    assert.equal(constantTimeEqual('short', 'longer'), false);
});

test('resume content validation accepts PDF and legacy DOC signatures', () => {
    const pdf = Buffer.from('%PDF-1.7\nresume');
    assert.equal(validateResumeContents({ bytes: pdf, name: 'resume.pdf', type: pdfType, declaredSize: pdf.length }), '');

    const doc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    assert.equal(validateResumeContents({ bytes: doc, name: 'resume.doc', type: docType, declaredSize: doc.length }), '');
});

test('DOCX validation requires a ZIP central directory with Office entries', () => {
    const docx = zipWithEntries(['[Content_Types].xml', 'word/document.xml']);
    assert.equal(validateResumeContents({ bytes: docx, name: 'resume.docx', type: docxType, declaredSize: docx.length }), '');

    const genericZip = zipWithEntries(['notes.txt']);
    assert.equal(validateResumeContents({
        bytes: genericZip,
        name: 'resume.docx',
        type: docxType,
        declaredSize: genericZip.length
    }), 'invalid_resume_content');
});

test('renamed and truncated files are rejected', () => {
    const fakePdf = Buffer.from('not a pdf');
    assert.equal(validateResumeContents({
        bytes: fakePdf,
        name: 'resume.pdf',
        type: pdfType,
        declaredSize: fakePdf.length
    }), 'invalid_resume_content');
    assert.equal(validateResumeContents({
        bytes: Buffer.from('%PDF-1.7'),
        name: 'resume.pdf',
        type: pdfType,
        declaredSize: 999
    }), 'resume_size_mismatch');
});
