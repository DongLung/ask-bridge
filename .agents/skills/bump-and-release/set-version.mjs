#!/usr/bin/env node
// Usage: node .agents/skills/bump-and-release/set-version.mjs <X.Y.Z>
//
// Writes the release version into every version-bearing file, then runs
// `cargo check` so Cargo.lock follows. Each pattern must match exactly once,
// so a moved or renamed version line fails loudly instead of being skipped.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('用法：node .agents/skills/bump-and-release/set-version.mjs X.Y.Z');
  process.exit(1);
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(root);

const SEMVER = String.raw`\d+\.\d+\.\d+`;
const targets = [
  // Only the [package] version: dependency versions use inline tables.
  ['Cargo.toml', new RegExp(String.raw`^(version = ")${SEMVER}(")`, 'm')],
  ['package.json', new RegExp(String.raw`^(  "version": ")${SEMVER}(")`, 'm')],
  ['src/main.rs', new RegExp(String.raw`(#\[command\(version = ")${SEMVER}("\)\])`)],
  ['install.ps1', new RegExp(String.raw`^(\$Version = ")${SEMVER}(")`, 'm')],
  ['install.sh', new RegExp(String.raw`^(VERSION=")${SEMVER}(")`, 'm')],
  ['scripts/ask.sh', new RegExp(String.raw`^(VERSION=")${SEMVER}(")`, 'm')],
];

for (const [file, pattern] of targets) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.match(new RegExp(pattern.source, `${pattern.flags}g`)) ?? [];
  if (matches.length !== 1) {
    console.error(`❌ ${file}：版本行應出現 1 次，實際 ${matches.length} 次（pattern: ${pattern}）`);
    process.exit(1);
  }
  fs.writeFileSync(file, content.replace(pattern, (_, before, after) => `${before}${version}${after}`));
  console.log(`✔ ${file} → ${version}`);
}

execFileSync('cargo', ['check', '--quiet'], { stdio: 'inherit' });
const lock = fs.readFileSync('Cargo.lock', 'utf8').replace(/\r\n/g, '\n');
if (!new RegExp(String.raw`name = "ask-bridge"\nversion = "${version.replace(/\./g, '\\.')}"`).test(lock)) {
  console.error('❌ Cargo.lock 未更新為新版本');
  process.exit(1);
}
console.log(`✔ Cargo.lock → ${version}`);
console.log(`\n✅ 版本已設為 ${version}`);
