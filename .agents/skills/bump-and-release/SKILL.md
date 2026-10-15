---
name: bump-and-release
description: 發版 ask-bridge：自行判斷版本號，提交未完成的變更，同步所有版本檔與 CHANGELOG，推送並通過 CI，打 tag，發布 GitHub Release（含繁中發行說明）與 npm。使用者說「發版」、「release」、「bump version」或指定 patch／minor／major 時使用。
---

# 發版

使用者說「發版」，就代表授權整個流程：提交、推送、打 tag、發布 GitHub Release 與 npm。全程由你決定版本號與每個步驟，**一路做到完成**。向使用者回報的時機只有兩個：發版完成，以及閘門失敗且你無法自行修正。

**完成條件**：GitHub Release 有 8 個平台檔案和繁中發行說明，npm 的 `latest` 等於新版本，且已向使用者回報第 7 步的摘要。

## 步驟

### 1. 收尾工作目錄

1. 確認在 `main`，並執行 `git pull --ff-only origin main`。
2. 若有未提交的變更：先執行 `cargo fmt --all`、`cargo test`、`npm test`，通過後依 `AGENTS.md` 的 Git 規範提交（Conventional Commits、完整繁中說明，一個主題一個 commit）。
3. 找出上一版：`git describe --tags --abbrev=0`。若 `<上一版>..HEAD` 沒有任何 commit，告訴使用者「沒有可發布的變更」並停止。

### 2. 決定版本號

使用者有指定版本或 patch／minor／major 時照用。否則依 `git log <上一版>..HEAD` 的 Conventional Commits 判斷：

| 條件 | 升級 |
| :--- | :--- |
| 有破壞性變更（`type!:` 或 `BREAKING CHANGE`） | major；目前是 `0.x` 時改為 minor |
| 有 `feat` | minor |
| 其他（`fix`、`docs`、`ci`、`chore`…） | patch |

### 3. 更新版本檔與 CHANGELOG

```bash
node .agents/skills/bump-and-release/set-version.mjs X.Y.Z
```

這支腳本會把版本寫進 6 個版本檔（`Cargo.toml`、`package.json`、`src/main.rs`、`install.ps1`、`install.sh`、`scripts/ask.sh`），再執行 `cargo check` 同步 `Cargo.lock`。版本檔清單以腳本為準；新增版本檔時要同時更新 `set-version.mjs` 與 `publish.mjs` 的檢查清單。

接著更新 `CHANGELOG.md`：把 `## [Unreleased]` 底下的內容移到新段落 `## [X.Y.Z] - YYYY-MM-DD`（今天日期），`[Unreleased]` 留空。若 `[Unreleased]` 原本就是空的，就依 `<上一版>..HEAD` 的 commit 撰寫條目。沿用既有分類標題，例如 `### 🚀 新增 (Added)`、`### 🔧 修復 (Fixed)`。

### 4. 提交版本

```bash
git add -A
git commit -F <訊息檔>
```

訊息格式：

```text
chore(release): bump version to X.Y.Z

此提交將專案各平台之版本與設定檔同步提升至 X.Y.Z（<patch|minor|major>），對應<一句話說明本版重點>：

- 更新 Cargo.toml 與 package.json 套件版本號。
- 更新 src/main.rs 中 Clap 內建 CLI 版本資訊。
- 同步更新 install.ps1、install.sh 與 scripts/ask.sh 腳本中的發布版本變數。
- 自動同步更新 Cargo.lock。
- 將 CHANGELOG.md 的 Unreleased 內容歸入 [X.Y.Z] - YYYY-MM-DD。
```

### 5. 發布

```bash
node .agents/skills/bump-and-release/publish.mjs X.Y.Z
```

腳本依序執行：發布前檢查（`main`、工作目錄乾淨、所有版本檔與 CHANGELOG 皆為 X.Y.Z）→ 本機 fmt／test／npm test → 推送 `main` → 等 `ci.yml` 對該 commit 成功 → 建立並推送 `vX.Y.Z` tag → 等 `release.yml` 建置並上傳 8 個檔案 → 等 `npm-publish.yml` 發布 → 確認 registry 已有新版本。全程約 10～15 分鐘；支援背景執行時，請放到背景並等它結束。

腳本失敗時會印出原因並停止。處理方式依失敗點而定：

- **tag 推送前**（本機驗證、CI）：修正問題，用新的 commit 提交，再以同一版本號重跑。
- **tag 推送後**（Release、npm）：依腳本印出的 `gh run rerun …` 重跑該 workflow，或修正後直接重跑腳本；腳本偵測到遠端已有該 tag 時會從 Release 步驟續跑。已推送的 tag 保持不動；需要改程式碼才能修好時，改發下一個 patch 版。

發布鏈的原理：`release.yml` 上傳完檔案後，由 `trigger-npm-publish` job 以 `workflow_dispatch` 觸發 `npm-publish.yml`。這是因為以 `GITHUB_TOKEN` 建立的 Release 不會觸發 `release` 事件。npm 使用 trusted publishing（GitHub OIDC，不需 `NPM_TOKEN`），npm 端綁定的 workflow 檔名是 `npm-publish.yml`。

### 6. 撰寫 GitHub Release 發行說明

`release.yml` 只會產生一行 `Full Changelog`，必須換成繁中（台灣用語）發行說明。內容只寫經 commit、diff 或 CHANGELOG 驗證過的事實；不確定的部分要明說範圍。

資料來源：

```bash
git log --reverse --pretty=format:'%h%x09%s' <上一版>..vX.Y.Z
git diff --stat <上一版>..vX.Y.Z
```

格式（沒有內容的區塊就刪掉）：

```markdown
## 發行重點

1～2 句說明使用者最有感的變更。

## 新增

## 修正

## 文件與網站

## 測試

## 注意事項

## 相關連結

- 完整變更紀錄: https://github.com/doggy8088/ask-bridge/compare/<上一版>...vX.Y.Z
```

寫入暫存檔後執行 `gh release edit vX.Y.Z --repo doggy8088/ask-bridge --notes-file <檔案>`，再用 `gh release view` 確認內容。

### 7. 回報

用繁體中文回報，內容包含：新版本號與升級類型（以及判斷理由）、本版重點、Release 網址、npm 網址，以及第 1 步替使用者提交的 commit（若有）。
