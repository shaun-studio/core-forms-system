#!/usr/bin/env python3
"""Read-only fleet audit of the vendored core-forms-system.

For each site under clients-projects/, compare its vendored library against the
MASTER AT THE SITE'S OWN VERSION -- comparing against the new master would flag
every site on an older release as customised, which is the opposite of useful.

Classifies each file as:
  identical    -- byte-for-byte
  formatting   -- differs only by whitespace/comments (the Prettier drift)
  substantive  -- differs after normalisation: a real site-side edit

Writes nothing. Only reads files and `git show` from the master repo.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path('/Users/shaunmichael/Documents/Claude/Projects/clients-projects')
MASTER = Path('/Users/shaunmichael/Documents/Claude/Projects/shaun-studio/Forms/core-forms-system')
VENDOR = 'src/lib/core-forms-system'
ENDPOINT = 'src/pages/api/submit-form.ts'


def norm(s: str) -> str:
    """Strip comments and all whitespace, so only real code differences remain.
    Mirrors the normaliser in the master's update-site-forms.mjs."""
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    s = re.sub(r'//[^\n]*', '', s)
    s = re.sub(r'\s+', '', s)
    for a, b in ((',}', '}'), (',)', ')'), (',]', ']')):
        s = s.replace(a, b)
    return s


def git_show(ref: str, rel: str):
    try:
        return subprocess.run(
            ['git', '-C', str(MASTER), 'show', f'{ref}:{rel}'],
            capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError:
        return None


def tags():
    out = subprocess.run(['git', '-C', str(MASTER), 'tag'],
                         capture_output=True, text=True).stdout
    return set(out.split())


TAGS = tags()

# Library files to compare: every .ts in the master, excluding tooling dirs.
LIB_FILES = sorted(
    str(p.relative_to(MASTER))
    for p in MASTER.rglob('*.ts')
    if '.git' not in p.parts
    and not str(p.relative_to(MASTER)).startswith(('api/', 'scripts/'))
)

rows = []
for site in sorted(p for p in ROOT.iterdir() if p.is_dir() and not p.name.startswith('.')):
    pkg = site / VENDOR / 'package.json'
    if not pkg.exists():
        rows.append({'site': site.name, 'version': '-', 'status': 'no library'})
        continue

    try:
        version = json.loads(pkg.read_text())['version']
    except Exception:
        version = '?'

    ref = f'v{version}' if f'v{version}' in TAGS else None
    counts = {'identical': 0, 'formatting': 0, 'substantive': 0, 'missing': 0}
    fmt_files, sub_files = [], []

    for rel in LIB_FILES:
        mine_p = site / VENDOR / rel
        if not mine_p.exists():
            counts['missing'] += 1
            continue
        base = git_show(ref, rel) if ref else None
        if base is None:
            base = (MASTER / rel).read_text()   # no tag for this version
        mine = mine_p.read_text()
        if mine == base:
            counts['identical'] += 1
        elif norm(mine) == norm(base):
            counts['formatting'] += 1
            fmt_files.append(rel)
        else:
            counts['substantive'] += 1
            sub_files.append(rel)

    # The per-site endpoint, copied from the master's api/ folder.
    ep_p = site / ENDPOINT
    if not ep_p.exists():
        ep = 'absent'
    else:
        base = git_show(ref, 'api/submit-form.ts') if ref else None
        if base is None:
            base = (MASTER / 'api/submit-form.ts').read_text()
        mine = ep_p.read_text()
        ep = 'identical' if mine == base else (
            'formatting' if norm(mine) == norm(base) else 'substantive')

    # Is the drift prevented going forward?
    pi_p = site / '.prettierignore'
    pi = pi_p.read_text() if pi_p.exists() else ''
    guard = ('lib' if VENDOR in pi else '') + ('+ep' if ENDPOINT in pi else '')

    rows.append({
        'site': site.name, 'version': version, 'baseline': ref or 'UNTAGGED',
        'status': 'ok', **counts, 'endpoint': ep, 'guard': guard or 'none',
        'fmt_files': fmt_files, 'sub_files': sub_files,
    })

# ── report ────────────────────────────────────────────────────────────────────
have = [r for r in rows if r['status'] == 'ok']
none = [r for r in rows if r['status'] == 'no library']

print(f'sites scanned: {len(rows)}   with library: {len(have)}   without: {len(none)}\n')

hdr = f"{'site':<34}{'ver':<8}{'base':<10}{'ident':>6}{'fmt':>5}{'subst':>6}{'miss':>5}  {'endpoint':<12}{'guard'}"
print(hdr)
print('-' * len(hdr))
for r in sorted(have, key=lambda r: (r['version'], r['site'])):
    print(f"{r['site']:<34}{r['version']:<8}{r['baseline']:<10}"
          f"{r['identical']:>6}{r['formatting']:>5}{r['substantive']:>6}{r['missing']:>5}  "
          f"{r['endpoint']:<12}{r['guard']}")

print('\n── version spread ──')
from collections import Counter
for v, n in sorted(Counter(r['version'] for r in have).items()):
    print(f'  v{v}: {n}')

print('\n── totals ──')
print(f"  sites with formatting drift in the library : {sum(1 for r in have if r['formatting'])}")
print(f"  sites with substantive library differences: {sum(1 for r in have if r['substantive'])}")
print(f"  sites whose submit-form.ts has drifted    : {sum(1 for r in have if r['endpoint'] == 'formatting')}")
print(f"  sites whose submit-form.ts is customised  : {sum(1 for r in have if r['endpoint'] == 'substantive')}")
print(f"  sites with no .prettierignore guard       : {sum(1 for r in have if r['guard'] == 'none')}")
print(f"  sites on an UNTAGGED version (no baseline): {sum(1 for r in have if r['baseline'] == 'UNTAGGED')}")

sub = [r for r in have if r['substantive']]
if sub:
    print('\n── substantive differences (real customisation, need eyes) ──')
    for r in sub:
        print(f"  {r['site']} (v{r['version']}): {', '.join(r['sub_files'])}")

if none:
    print(f"\n── no vendored library ({len(none)}) ──")
    print('  ' + ', '.join(r['site'] for r in none))
