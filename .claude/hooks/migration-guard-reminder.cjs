#!/usr/bin/env node
// PreToolUse(Bash) reminder: `git commit`/`git push` with staged migration files
// should have gone through the db-migration-guard sub-agent first (CLAUDE.md
// "DB şema değişikliği: db-migration-guard migration script'i yazmadan merge yok").
// Non-blocking — prints a reminder Claude sees before running the command.

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

  if (input.tool_name !== 'Bash') process.exit(0);
  const command = String(input.tool_input?.command ?? '');
  if (!/\bgit\s+(commit|push)\b/.test(command)) process.exit(0);

  let staged = '';
  try {
    staged = execSync('git diff --cached --name-only', {
      cwd: input.cwd || process.cwd(),
      encoding: 'utf8',
    });
  } catch {
    process.exit(0);
  }

  const touchesMigration = staged
    .split('\n')
    .some((f) => f.startsWith('packages/db/migrations/') || f.startsWith('packages\\db\\migrations\\'));

  if (touchesMigration) {
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          'Hatırlatma: staged değişiklik packages/db/migrations/ altında bir dosya içeriyor. ' +
          'db-migration-guard sub-agent review\'ı bu commit/push öncesi alındı mı? (CLAUDE.md: "DB şema değişikliği: ' +
          'db-migration-guard migration script\'i yazmadan merge yok")',
      },
    };
    process.stdout.write(JSON.stringify(out));
  }
  process.exit(0);
});
