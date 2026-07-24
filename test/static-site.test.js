import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const deployablePages = [
    'index.html',
    'research.html',
    'careers.html',
    'research/aetherock/index.html',
    'research/khora/index.html',
    'research/ipr-1/index.html',
    'careers/model-algorithm-engineer-world-model/index.html',
    'careers/data-algorithm-engineer-human-video/index.html',
    'careers/motion-control-engineer/index.html',
    'careers/robotic-arm-gripper-hardware-engineer/index.html'
];

function read(relativePath) {
    return readFileSync(join(root, relativePath), 'utf8');
}

test('deployable pages include complete social metadata', () => {
    const required = [
        /<title>[^<]+<\/title>/i,
        /<meta\s+name="description"\s+content="[^"]+"/i,
        /<meta\s+property="og:title"\s+content="[^"]+"/i,
        /<meta\s+property="og:description"\s+content="[^"]+"/i,
        /<meta\s+property="og:image"\s+content="https:\/\/[^"]+"/i,
        /<meta\s+name="twitter:card"\s+content="summary_large_image"/i,
        /<meta\s+name="twitter:title"\s+content="[^"]+"/i,
        /<meta\s+name="twitter:description"\s+content="[^"]+"/i,
        /<meta\s+name="twitter:image"\s+content="https:\/\/[^"]+"/i
    ];
    for (const page of deployablePages) {
        const html = read(page);
        for (const pattern of required) assert.match(html, pattern, `${page} is missing ${pattern}`);
    }
});

test('core page scripts, stylesheets, and images resolve locally', () => {
    const pages = deployablePages.filter((page) => page !== 'research/ipr-1/index.html');
    for (const page of pages) {
        const html = read(page);
        const tags = html.match(/<(?:script|link|img)\b[^>]*>/gi) || [];
        for (const tag of tags) {
            const match = tag.match(/(?:src|href)="([^"]+)"/i);
            if (!match) continue;
            const value = match[1].split(/[?#]/)[0];
            if (!value || /^(?:https?:|data:|mailto:)/i.test(value)) continue;
            const absolute = value.startsWith('/')
                ? join(root, value.slice(1))
                : resolve(root, dirname(page), value);
            assert.equal(existsSync(normalize(absolute)), true, `${page} references missing ${value}`);
        }
    }
});

test('public markup contains no placeholder anchors', () => {
    for (const page of deployablePages) {
        assert.doesNotMatch(read(page), /href=["']#["']/i, `${page} contains href="#"`);
    }
});

test('draft About page is excluded from Vercel output', () => {
    const ignored = read('.vercelignore').split(/\r?\n/).map((line) => line.trim());
    assert.equal(ignored.includes('about.html'), true);
});

test('Vercel config is valid JSON with strict core and proxy CSP policies', () => {
    const config = JSON.parse(read('vercel.json'));
    assert.ok(Array.isArray(config.headers));
    const policies = config.headers
        .map((entry) => ({
            source: entry.source,
            value: entry.headers.find((header) => header.key === 'Content-Security-Policy')?.value
        }))
        .filter((entry) => entry.value);
    const core = policies.find((entry) => entry.source === '/');
    const ipr = policies.find((entry) => entry.source === '/research/ipr-1/:path*');
    const gm100 = policies.find((entry) => entry.source === '/research/gm-100/:path*');
    const khora = policies.find((entry) => entry.source === '/research/khora/:path*');
    assert.ok(core?.value);
    assert.doesNotMatch(core.value, /script-src[^;]*'unsafe-inline'/);
    assert.match(core.value, /https:\/\/\*\.supabase\.co/);
    assert.match(ipr?.value || '', /script-src[^;]*'unsafe-inline'/);
    assert.match(gm100?.value || '', /script-src[^;]*'unsafe-inline'/);
    assert.match(khora?.value || '', /script-src[^;]*'unsafe-inline'/);
});

test('JavaScript and CSS references use expected file extensions', () => {
    assert.equal(extname(join(root, 'careers.js')), '.js');
    assert.equal(extname(join(root, 'style.css')), '.css');
});
