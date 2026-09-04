// PreToolUse guard: blocks obviously destructive shell commands. Exit 2 = block.
//
// Lifted from dona-v3 (slice 1.2, docs/from-v3.md Tier 1). One pattern widened: the root-deletion
// case now also catches `rm -rf /*` and `--no-preserve-root`, which v3's `\/(\s|$)` let through.
// It is a blunt net over known-destructive commands, not an allowlist — see the fail-open note.
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let command = '';
try {
  command = JSON.parse(raw)?.tool_input?.command ?? '';
} catch {
  // Fail open. A guard that blocks every command when the payload shape changes bricks the
  // session, and the destructive commands below are the ones it exists for — not all of them.
  process.exit(0);
}
const deny = [
  [/\brm\s+(-[a-z]*f[a-z]*\s+|--force\s+|--no-preserve-root\s+)+\/(\s|$|\*)/i, 'rm -rf on filesystem root'],
  [/\bgit\s+push\b.*(--force|-f)\b/i, 'force push (use --force-with-lease deliberately, outside hooks)'],
  [/\bpsql\b.*prod/i, 'raw psql against a prod database'],
  [/\bgcloud\b.*\b(delete|destroy)\b/i, 'destructive gcloud command'],
  [/\bdrop\s+(database|schema)\b/i, 'DROP DATABASE/SCHEMA'],
];
for (const [re, why] of deny) {
  if (re.test(command)) {
    console.error(`Blocked by guard-bash hook: ${why}. Run it manually if truly intended.`);
    process.exit(2);
  }
}
process.exit(0);
