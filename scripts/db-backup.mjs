#!/usr/bin/env node
// Download a full backup of the linked Supabase project (schema, roles and data) into
// backups/<timestamp>/ using the Supabase CLI. Works on Windows, macOS and Linux.
//
//   npx supabase login            (once)
//   npx supabase link --project-ref <ref>   (once, in this folder)
//   npm run db:backup
//
// Then check the backup restores (see docs/SUPPORTER-FEATURES.md → Backups).
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join('backups', stamp);
mkdirSync(dir, { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const steps = [
  ['roles.sql', ['supabase', 'db', 'dump', '--linked', '--role-only', '-f']],
  ['schema.sql', ['supabase', 'db', 'dump', '--linked', '-f']],
  ['data.sql', ['supabase', 'db', 'dump', '--linked', '--data-only', '--use-copy', '-f']],
];
for (const [file, args] of steps) {
  const out = path.join(dir, file);
  console.log(`→ ${out}`);
  const run = spawnSync(npx, [...args, out], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (run.status !== 0) {
    console.error(`Backup step failed (${file}). Is the project linked? Run: npx supabase link --project-ref <ref>`);
    process.exit(1);
  }
  if (statSync(out).size === 0) { console.error(`${file} is empty — something is wrong.`); process.exit(1); }
}
console.log(`\nBackup saved in ${dir}. It contains donor emails: keep it private and encrypted (never commit it).`);
