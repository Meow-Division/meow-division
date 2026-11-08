#!/usr/bin/env node
// PreToolUse guard for Claude Code. Blocks the actions HACKATHON.md reserves for the human:
// pushing, making the repo public, mainnet deploys and transfers, submitting, posting on X,
// and touching .env files. Exit 2 = block, with the reason on stderr. Exit 0 = let it through.
// Codex has no hooks: the same list is in AGENTS.md.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const tool = input.tool_name || '';
const ti = input.tool_input || {};

const block = (why, how) => {
  process.stderr.write(`Blocked: ${why}\n${how ? how + '\n' : ''}`);
  process.exit(2);
};

if (tool === 'Bash') {
  const cmd = String(ti.command || '');
  const rules = [
    [/\bgit\b[^\n|;&]*\bpush\b/, 'git push needs the human.', 'Ask them to run it: `! git push origin <branch>`.'],
    [/\bgh\s+repo\s+(edit|create)\b[^\n]*(--public|--visibility\s+public)/, 'making the repository public needs the human.', 'They do it on GitHub (Settings > Danger zone) when the README and LICENSE are ready.'],
    [/\bcargo\s+near\s+deploy\b/, 'mainnet deploy needs the human.', 'Build with `cargo near build`, print the deploy command, wait for yes.'],
    [/\bnear\b[^\n]*\b(deploy|send-near|send-ft|send-nft|add-key|delete-keys?|delete-account|create-account)\b/, 'a mainnet transaction needs the human.', 'Print the exact command and wait for yes.'],
    [/\bnear\b[^\n]*\bcall-function\s+as-transaction\b/, 'a mainnet transaction needs the human.', 'Read-only calls are `as-read-only`.'],
    [/nearhackathon\.com\/api\/applications/, 'the submission is sent once, by hand.', 'Print the JSON payload, wait for yes, then the human runs the curl.'],
    [/api\.(twitter|x)\.com|\bx\.com\/i\/api/, 'posting on X is the human\'s job.', 'Hand them the draft text.'],
    [/\bgit\b[^\n]*\b(push|commit)\b[^\n]*--no-verify/, 'hooks are not skipped.', ''],
    [/\brm\s+-rf?\s+(\/|~|\$HOME|D:|C:)(\s|$)/, 'that delete is too broad.', ''],
  ];
  for (const [re, why, how] of rules) if (re.test(cmd)) block(why, how);

  // Parix (other sites on the shared server) is off limits. The ssh key file is named parix_codex; that alone is fine.
  if (/parix/i.test(cmd.replace(/parix_codex(\.pub)?/gi, ''))) {
    block('Parix is never touched: not its sites, nginx files, certificates or folders.', 'Meow Division only uses /srv/meow, /etc/nginx/sites-available/meow and its own certificate.');
  }

  if (/\bgit\s+add\b/.test(cmd)) {
    const envFiles = (cmd.match(/(?:^|[\s/'"])(\.env(?:\.[\w.-]+)?)(?=$|[\s'"])/g) || [])
      .map((m) => m.trim().replace(/^['"/]/, ''))
      .filter((f) => !/example$/.test(f));
    if (envFiles.length) block('.env files are never committed.', `Staged: ${envFiles.join(', ')}. Keep secrets in .env, names in .env.example.`);
  }

  if (/\bgit\s+commit\b/.test(cmd)) {
    try {
      execFileSync(process.execPath, ['scripts/check-secrets.mjs', '--staged'], {
        cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (e) {
      const msg = e.stderr ? e.stderr.toString() : String(e);
      block('the staged diff looks like it contains a secret.', msg.trim());
    }
  }
}

if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
  const p = String(ti.file_path || ti.notebook_path || '').replace(/\\/g, '/');
  const base = p.split('/').pop() || '';
  if (/^\.env(\..+)?$/.test(base) && !/example$/.test(base)) {
    block('.env files are edited by the human.', 'Add the variable name to .env.example and tell them the value to set.');
  }
  if (/parix/i.test(p)) {
    block('Parix is never touched.', '');
  }
  if (/^(id_ed25519|id_rsa|id_ecdsa|secret|secrets|[\w.-]+\.(pem|p12|key))$/i.test(base) || /(^|\/)\.ssh\//.test(p)) {
    block('that path looks like key material.', '');
  }
}

process.exit(0);
