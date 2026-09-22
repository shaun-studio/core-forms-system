#!/usr/bin/env node
/**
 * update-site-forms.mjs — bring one site up to the current core-forms-system.
 *
 *   node update-site-forms.mjs <site-path> [--dry-run]
 *
 * Two steps, both idempotent:
 *
 *   1. Re-vendor src/lib/core-forms-system/ from the canonical master.
 *   2. Add maxlength to form inputs that don't have one, using the caps the
 *      site's own API routes enforce — never tighter than its server allows.
 *
 * Deliberately conservative:
 *   - Skips components no page or component imports (dead code).
 *   - Skips any input that already has a maxlength.
 *   - Never touches the honeypot.
 *   - Refuses to overwrite a vendored file the site has customised, unless
 *     --force is passed. peaceforce's careers-handler.ts is the known case.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, resolve, relative, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const MASTER = resolve(fileURLToPath(new URL('..', import.meta.url)));   // this library's root
const DEFAULT_CAPS = { name: 100, phone: 30, email: 254, service: 100, location: 200, message: 2000, number: 100 };
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.git', '.wrangler']);

const [, , sitePathArg, ...flags] = process.argv;
const dry = flags.includes('--dry-run');
const force = flags.includes('--force');
if (!sitePathArg) { console.error('usage: update-site-forms.mjs <site-path> [--dry-run] [--force]'); process.exit(1); }
const SITE = resolve(sitePathArg);

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// ── step 1: re-vendor ────────────────────────────────────────────────────────
const vendored = join(SITE, 'src/lib/core-forms-system');
if (!existsSync(vendored)) { console.error(`no vendored library at ${vendored}`); process.exit(1); }

const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '').replace(/,\}/g, '}').replace(/,\)/g, ')').replace(/,\]/g, ']');

/* A site is "customised" only if it differs from the master RELEASE IT IS ON,
   not from the new one. Comparing against the new master would flag every
   site still on the previous version as customised, which is the opposite of
   useful. Baseline comes from the master's own git history. */
/* Baseline = the tagged release the site is actually on, so only genuine
   site-side edits count as customisation. Falls back to HEAD~1 if that
   version was never tagged. */
const show = (ref, rel) => {
  try {
    return execFileSync('git', ['-C', MASTER, 'show', `${ref}:${rel}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
};
const baselineOf = (rel) => {
  const ref = process.env.FORMS_BASELINE_REF;
  if (ref) return show(ref, rel);
  return (siteVersionEarly && show(`v${siteVersionEarly}`, rel)) || show('HEAD~1', rel);
};
const siteVersionEarly = existsSync(join(vendored, 'package.json'))
  ? JSON.parse(readFileSync(join(vendored, 'package.json'), 'utf8')).version : null;
const customised = [];
for (const f of walk(MASTER).filter((f) => ['.ts', '.js'].includes(extname(f)))) {
  const rel = relative(MASTER, f);
  if (rel.startsWith('api/') || rel.startsWith('.git')) continue;
  const mine = join(vendored, rel);
  if (!existsSync(mine)) continue;
  const base = baselineOf(rel);
  const compareTo = base ?? readFileSync(f, 'utf8');   // no baseline: fall back to the new master
  if (norm(compareTo) !== norm(readFileSync(mine, 'utf8'))) customised.push(rel);
}
const masterVersion = JSON.parse(readFileSync(join(MASTER, 'package.json'), 'utf8')).version;
const siteVersion = siteVersionEarly ?? 'unknown';

if (customised.length && !force) {
  console.log(`library: v${siteVersion} -> v${masterVersion}  SKIPPED`);
  console.log(`  this site has customised: ${customised.join(', ')}`);
  console.log('  re-vendoring would overwrite it. Re-run with --force, or copy the other files by hand.');
} else if (!dry) {
  for (const f of walk(MASTER).filter((f) => !relative(MASTER, f).startsWith('.git'))) {
    const rel = relative(MASTER, f);
    if (rel.startsWith('api/') || rel === 'package-lock.json' || basename(f) === '.DS_Store') continue;
    cpSync(f, join(vendored, rel), { force: true });
  }
  console.log(`library: v${siteVersion} -> v${masterVersion}`);
} else {
  console.log(`library: v${siteVersion} -> v${masterVersion}  (dry run)`);
}

// ── step 2: caps, derived from this site's own routes ────────────────────────
const caps = { ...DEFAULT_CAPS };
const apiDir = join(SITE, 'src/pages/api');
if (existsSync(apiDir)) {
  for (const f of readdirSync(apiDir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(apiDir, f), 'utf8');
    for (const m of src.matchAll(/(\w+):\s*\{[^{}]*maxLength:\s*(\d+)/g)) {
      const [, field, n] = m;
      if (field in caps) caps[field] = Math.max(caps[field], Number(n));  // never cap tighter than the server
    }
  }
}

const astro = walk(join(SITE, 'src')).filter((f) => f.endsWith('.astro'));
const sources = new Map(astro.map((f) => [f, readFileSync(f, 'utf8')]));
const isImported = (file) => {
  const stem = basename(file, '.astro');
  for (const [other, text] of sources) if (other !== file && text.includes(stem)) return true;
  return false;
};

let touched = 0, skippedDead = 0;
for (const [file, text] of sources) {
  if (!/<(input|textarea)\b/i.test(text)) continue;
  if (!isImported(file)) {
    if (/<(input|textarea)\b[^>]*name="(name|phone|email|service|location|message|number)"/i.test(text)) skippedDead++;
    continue;
  }
  let count = 0;
  const next = text.replace(/<(input|textarea)\b[^>]*>/gi, (tag) => {
    const nm = tag.match(/\bname="([^"]+)"/);
    if (!nm || !(nm[1] in caps) || /\bmaxlength=/i.test(tag)) return tag;
    count++;
    return tag.replace(/(\s*\/?>)$/, ` maxlength="${caps[nm[1]]}"$1`);
  });
  if (count) {
    if (!dry) writeFileSync(file, next);
    touched += count;
    console.log(`  ${relative(SITE, file)}: ${count} capped`);
  }
}
console.log(`inputs capped: ${touched}${skippedDead ? `  (skipped ${skippedDead} file(s) no page imports)` : ''}`);
console.log(`caps used: ${JSON.stringify(caps)}`);
if (dry) console.log('\n(dry run — nothing written)');
