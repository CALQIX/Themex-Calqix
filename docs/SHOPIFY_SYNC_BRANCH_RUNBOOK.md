# Shopify ↔ GitHub Sync Branch Runbook

## Goal
Eliminate the race condition where Shopify Theme Editor edits (saved via the Online Store → Themes → GitHub integration) push directly to `main` at the same time that developers push commits to `main`, causing merge conflicts and lost work.

## New Architecture
- Shopify GitHub integration pushes to branch: **`theme/shopify-sync`**
- Developers push commits to: **`main`** (as before)
- Changes flow from `theme/shopify-sync` → `main` via manual **Pull Request** review

```
Shopify Theme Editor ──► theme/shopify-sync ──(PR + review)──► main
Developers ──────────────────────────────────────────────────► main
```

## One-time setup (Shopify Admin — requires manual action)

1. Open Shopify Admin → **Online Store** → **Themes**
2. Find the theme connected to GitHub (Themex-Calqix)
3. Click the **···** menu on the theme tile → **Edit code** is NOT what we need; instead look for **GitHub** or **Connected to GitHub** indicator
4. Click the GitHub connection settings (usually a gear icon or "Manage connection")
5. Change **Branch** from `main` to `theme/shopify-sync`
6. Save

Alternative path if the UI differs:
- Online Store → Themes → **Add theme** → **Connect from GitHub** → select `theme/shopify-sync` branch → then disconnect the old `main`-linked theme.

After the change, **Theme Editor saves will only affect `theme/shopify-sync`** — never `main` directly.

## Daily workflow

### When Shopify Admin / operator edits the theme in Theme Editor
1. Shopify auto-commits changes to `theme/shopify-sync`
2. GitHub shows "This branch is N commits ahead of main"
3. Open a PR: `theme/shopify-sync` → `main`
4. Review the diff (usually only `templates/*.json`, `config/settings_data.json`, or section JSON blocks)
5. Merge the PR (use **Merge commit** to preserve Shopify's commit authorship, not squash)
6. Pull `main` locally: `git pull origin main`

### When developers push code changes
- Push to `main` as normal.
- After merging, if `theme/shopify-sync` is now behind, **rebase it onto main**:
  ```powershell
  git fetch origin
  git push origin origin/main:refs/heads/theme/shopify-sync --force-with-lease
  ```
  This keeps Shopify's sync branch aligned with `main`, so the next operator edit diff is clean.

## Conflict handling
If a PR from `theme/shopify-sync` has conflicts with `main`:
1. Checkout `theme/shopify-sync` locally
2. `git rebase origin/main`
3. Resolve conflicts (usually in `templates/*.json` or `config/settings_data.json`)
4. `git push --force-with-lease origin theme/shopify-sync`
5. Re-open / update the PR and merge

## Safety notes
- Never force-push to `main`.
- Never delete `theme/shopify-sync` — it is Shopify's write target.
- If Shopify connection ever breaks, reconnect to `theme/shopify-sync` (not `main`).
- Keep the PR template focused: confirm no schema `id` renames, no locale key renames (per `AGENTS.md`).

## Rollback
If this flow causes issues and you need to revert to Shopify → main directly:
1. Shopify Admin → Themes → GitHub settings → change branch back to `main`
2. Delete or archive `theme/shopify-sync` only after confirming Shopify is writing to `main` again
