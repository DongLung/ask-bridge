#!/usr/bin/env node
// Usage: node .agents/skills/bump-and-release/publish.mjs <X.Y.Z>
//
// Ships a release that is already committed on main:
//   preflight → local gates → push main → CI gate → tag → Release workflow
//   → npm trusted publishing → registry check.
// Safe to rerun with the same version: once the tag is on origin, the script
// resumes from the Release workflow instead of pushing or tagging again.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const REPO = 'doggy8088/ask-bridge';
const PACKAGE = 'ask-bridge';
const EXPECTED_ASSETS = 8; // 4 targets × (archive + .sha256)
const isWindows = process.platform === 'win32';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('用法：node .agents/skills/bump-and-release/publish.mjs X.Y.Z');
  process.exit(1);
}
const tag = `v${version}`;

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▶ ${message}`);
}

// npm is npm.cmd on Windows and needs a shell; its arguments here contain no
// spaces or cmd.exe metacharacters. Everything else runs without a shell so
// arguments such as `^{}` reach git verbatim.
function exec(command, args, { inherit = false, allowFail = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    shell: isWindows && command === 'npm',
  });
  const ok = result.status === 0;
  if (!ok && !allowFail) {
    const detail = (result.stderr || '').trim();
    fail(`${command} ${args.join(' ')} 失敗${detail ? `：\n${detail}` : ''}`);
  }
  return { ok, out: (result.stdout || '').trim() };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findRun(workflow, { event, commit, branch }, timeoutMinutes = 10) {
  const args = ['run', 'list', '--repo', REPO, '--workflow', workflow, '--limit', '20',
    '--json', 'databaseId,headSha,event,headBranch,status,conclusion'];
  if (commit) args.push('--commit', commit);
  const deadline = Date.now() + timeoutMinutes * 60_000;
  while (Date.now() < deadline) {
    const runs = JSON.parse(exec('gh', args).out || '[]');
    const match = runs.find((run) => (!event || run.event === event)
      && (!commit || run.headSha === commit)
      && (!branch || run.headBranch === branch));
    if (match) return match;
    await sleep(10_000);
  }
  return fail(`${timeoutMinutes} 分鐘內找不到 ${workflow} 的 run（event=${event ?? '*'}, commit=${commit ?? '*'}, branch=${branch ?? '*'}）`);
}

async function waitForSuccess(run, label, timeoutMinutes = 40) {
  const url = `https://github.com/${REPO}/actions/runs/${run.databaseId}`;
  console.log(`  ${label}：${url}`);
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let state = run;
  while (state.status !== 'completed') {
    if (Date.now() > deadline) fail(`${label} 超過 ${timeoutMinutes} 分鐘仍未完成：${url}`);
    await sleep(15_000);
    state = JSON.parse(exec('gh', ['run', 'view', String(run.databaseId), '--repo', REPO,
      '--json', 'status,conclusion']).out);
  }
  if (state.conclusion !== 'success') {
    fail(`${label} 結果為 ${state.conclusion}：${url}\n  修正後可重跑：gh run rerun ${run.databaseId} --repo ${REPO} --failed`);
  }
  console.log(`  ✔ ${label} 成功`);
}

function npmHasVersion() {
  const result = exec('npm', ['view', `${PACKAGE}@${version}`, 'version', '--prefer-online'], { allowFail: true });
  return result.ok && result.out === version;
}

// ── Preflight ───────────────────────────────────────────────────────────────
step(`發布前檢查 ${tag}`);
process.chdir(exec('git', ['rev-parse', '--show-toplevel']).out);
if (exec('git', ['branch', '--show-current']).out !== 'main') fail('目前不在 main 分支');
if (exec('git', ['status', '--porcelain']).out) fail('工作目錄有未提交的變更，請先提交');

const versionChecks = [
  ['Cargo.toml', `version = "${version}"`],
  ['package.json', `"version": "${version}"`],
  ['src/main.rs', `#[command(version = "${version}")]`],
  ['install.ps1', `$Version = "${version}"`],
  ['install.sh', `VERSION="${version}"`],
  ['scripts/ask.sh', `VERSION="${version}"`],
  ['Cargo.lock', `name = "ask-bridge"\nversion = "${version}"`],
  ['CHANGELOG.md', `## [${version}]`],
];
for (const [file, needle] of versionChecks) {
  if (!fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').includes(needle)) {
    fail(`${file} 未包含 ${JSON.stringify(needle)}；請先執行 set-version.mjs 並更新 CHANGELOG`);
  }
}

const releaseCommit = exec('git', ['rev-parse', 'HEAD']).out;
// Annotated tags are listed twice; the `^{}` line carries the tagged commit.
const remoteRefs = new Map(exec('git', ['ls-remote', '--tags', 'origin']).out.split('\n')
  .map((line) => line.split('\t').reverse()));
const remoteTag = remoteRefs.get(`refs/tags/${tag}^{}`) ?? remoteRefs.get(`refs/tags/${tag}`) ?? '';
if (remoteTag && remoteTag !== releaseCommit) {
  fail(`遠端 ${tag} 指向 ${remoteTag}，不是目前的 HEAD ${releaseCommit}；不可覆寫既有 tag`);
}
const resuming = Boolean(remoteTag);
console.log(`  release commit：${releaseCommit}${resuming ? `（${tag} 已在遠端，從 Release 步驟續跑）` : ''}`);

if (!resuming) {
  // ── Local gates ─────────────────────────────────────────────────────────
  step('本機驗證：格式、Rust 測試、npm 測試');
  exec('cargo', ['fmt', '--all', '--', '--check'], { inherit: true });
  exec('cargo', ['test', '--quiet'], { inherit: true });
  exec('npm', ['test', '--silent'], { inherit: true });

  // ── Push main + CI gate ─────────────────────────────────────────────────
  step('推送 main');
  exec('git', ['push', 'origin', 'main'], { inherit: true });
  exec('git', ['fetch', 'origin', 'main', '--quiet']);
  if (exec('git', ['rev-parse', 'origin/main']).out !== releaseCommit) {
    fail('origin/main 未指向 release commit');
  }

  step('等待 CI（ci.yml）');
  await waitForSuccess(await findRun('ci.yml', { event: 'push', commit: releaseCommit }), 'CI');
  exec('git', ['fetch', 'origin', 'main', '--quiet']);
  if (exec('git', ['rev-parse', 'origin/main']).out !== releaseCommit) {
    fail('CI 期間 origin/main 已前進；請以新的 main HEAD 重新發版');
  }

  // ── Tag ─────────────────────────────────────────────────────────────────
  step(`建立並推送 ${tag}`);
  const localTag = exec('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { allowFail: true }).out;
  if (localTag && localTag !== releaseCommit) fail(`本機 ${tag} 指向其他 commit；不可覆寫`);
  if (!localTag) exec('git', ['tag', '-a', tag, releaseCommit, '-m', tag]);
  exec('git', ['push', 'origin', `refs/tags/${tag}`], { inherit: true });
}

// ── GitHub Release ──────────────────────────────────────────────────────────
step('等待 Release workflow（release.yml）建置並上傳平台檔案');
await waitForSuccess(
  await findRun('release.yml', { event: 'push', commit: releaseCommit, branch: tag }),
  'Release',
);
const release = JSON.parse(exec('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'url,assets']).out);
if (release.assets.length < EXPECTED_ASSETS) {
  fail(`${tag} 只有 ${release.assets.length} 個檔案，預期 ${EXPECTED_ASSETS} 個：${release.url}`);
}
console.log(`  ✔ ${release.url}（${release.assets.length} 個檔案）`);

// ── npm trusted publishing ──────────────────────────────────────────────────
step('等待 npm 發布（npm-publish.yml，trusted publishing）');
if (npmHasVersion()) {
  console.log(`  ✔ ${PACKAGE}@${version} 已在 npm 上`);
} else {
  await waitForSuccess(
    await findRun('npm-publish.yml', { event: 'workflow_dispatch', branch: tag }),
    'npm publish',
  );
  let published = false;
  for (let attempt = 0; attempt < 18 && !published; attempt += 1) {
    published = npmHasVersion();
    if (!published) await sleep(10_000);
  }
  if (!published) {
    fail(`npm publish 成功但 3 分鐘內 registry 仍查不到 ${PACKAGE}@${version}`);
  }
  console.log(`  ✔ ${PACKAGE}@${version} 已在 npm 上`);
}

console.log(`
✅ ${tag} 發布完成
  commit : ${releaseCommit}
  Release: ${release.url}
  npm    : https://www.npmjs.com/package/${PACKAGE}/v/${version}`);
