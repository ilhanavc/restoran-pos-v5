#!/usr/bin/env node
// Stop hook reminder: if this turn touched apps/web or apps/mobile UI code,
// nudge toward hci-reviewer / i18n-key-checker / turkish-ux-reviewer before
// the PR is opened (CLAUDE.md: "hci-reviewer onayı olmadan merge yok").
// Non-blocking — informational only, never stops the session.
// Known gap: `git status --porcelain` collapses a brand-new untracked
// directory into one line (no file extension to match) — a first file
// created inside a not-yet-tracked subfolder won't trigger this reminder.

const { execSync } = require('node:child_process');

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    process.exit(0);
  }

  let changed = '';
  try {
    changed = execSync('git status --porcelain', {
      cwd: input.cwd || process.cwd(),
      encoding: 'utf8',
    });
  } catch {
    process.exit(0);
  }

  const uiFilePattern = /^(apps\/(web|mobile)\/src\/.*\.(tsx|ts))$/;
  const files = changed
    .split('\n')
    .map((l) => l.slice(3).trim().replace(/\\/g, '/'))
    .filter(Boolean);
  const touchesUi = files.some((f) => uiFilePattern.test(f) && !f.includes('.test.'));

  if (touchesUi) {
    process.stdout.write(
      "> Hatırlatma: apps/web veya apps/mobile UI kodu değişti. PR açmadan önce hci-reviewer + " +
      "i18n-key-checker + turkish-ux-reviewer sub-agent'ları çağrıldı mı?",
    );
  }
  process.exit(0);
});
