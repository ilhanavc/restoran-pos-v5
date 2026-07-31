#!/usr/bin/env node
// PreToolUse(Bash) guard: destructive SQL/psql commands aimed at prod ask for confirmation.
// CLAUDE.md "Asla yapmayacaklarımız": kullanıcı verisini prod DB'de test amaçlı silmek.
// Prod Postgres yalnız localhost dinler (docs/ops/deploy.md §2) — buraya ulaşan tek yol
// SSH tüneli veya prod sunucu üzerinde çalışan komut; her ikisi de aşağıdaki işaretlerden
// birini taşır.

const PROD_MARKERS = [
  '167.233.78.127',
  'pos_prod',
  'restoran_pos_ed25519',
];

const DESTRUCTIVE_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];

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
  if (!command) process.exit(0);

  const touchesProd = PROD_MARKERS.some((m) => command.includes(m));
  const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
  // UPDATE without a WHERE clause is a full-table write — also treat as destructive.
  const isUnboundedUpdate = /\bUPDATE\s+\S+\s+SET\b/i.test(command) && !/\bWHERE\b/i.test(command);

  if (touchesProd && (isDestructive || isUnboundedUpdate)) {
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          'Bu komut prod veritabanına yıkıcı bir SQL işlemi (DROP/TRUNCATE/DELETE/WHEREsiz UPDATE) gönderiyor gibi görünüyor. ' +
          'CLAUDE.md: "Asla kullanıcı verisini prod DB\'de test amaçlı silmek". Devam etmeden önce kullanıcıya onaylat.',
      },
    };
    process.stdout.write(JSON.stringify(out));
  }
  process.exit(0);
});
