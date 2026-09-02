# GitHub Pages for this fork

This repo is **`TimothyYao/factorio-blueprint-editor-universal`**, a fork of
[`trisiak/factorio-blueprint-editor`](https://github.com/trisiak/factorio-blueprint-editor),
itself a fork of
[`Teoxoy/factorio-blueprint-editor`](https://github.com/Teoxoy/factorio-blueprint-editor).
It publishes its own site. The pack-data plane stays on the parent line
([`trisiak/factorio-pack-data`](https://github.com/trisiak/factorio-pack-data))
and is **not** republished from here.

| What        | URL                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- |
| This site   | https://timothyyao.github.io/factorio-blueprint-editor-universal/                     |
| PR preview  | `https://timothyyao.github.io/factorio-blueprint-editor-universal/pr-preview/pr-<N>/` |
| Parent fork | https://trisiak.github.io/factorio-blueprint-editor/                                  |
| Original    | https://fbe.teoxoy.com                                                                |
| Pack data   | https://trisiak.github.io/factorio-pack-data/                                         |

Vite `base` must be the project-site path (`/factorio-blueprint-editor-universal/`).
The production and preview workflows set `PUBLIC_BASE` from
`${{ github.event.repository.name }}` so a rename does not silently keep the
parent's `/factorio-blueprint-editor/` path.

## What the workflows do (in-repo)

- [`.github/workflows/pages-prod.yml`](../.github/workflows/pages-prod.yml) —
  on push to `master` (or `workflow_dispatch`), builds the website and publishes
  `packages/website/dist` to the **root** of the `gh-pages` branch. Leaves
  `pr-preview/` alone.
- [`.github/workflows/pages-preview.yml`](../.github/workflows/pages-preview.yml)
  — on pull-request open/sync/reopen, publishes a preview under
  `pr-preview/pr-<N>/` on the same branch and comments the URL; on close, removes
  it.

Both keep `VITE_DATA_URL=https://trisiak.github.io/factorio-pack-data`. Cloudflare
Pages Functions (`functions/corsproxy.js`) do **not** run here, but URL-based
blueprint import works anyway for hosts that send CORS headers (pastebin raw,
the gist API, Google Docs exports, Dropbox's dl.dropboxusercontent.com, and the
factorioprints Firebase DB — which also serves factorio.school links, same
keys) — the loader fetches those directly from the browser and only falls back
to `/corsproxy` when the direct fetch is CORS-blocked (gitlab raw, FactorioBin,
FactorioCodex — all verified CORS-less 2026-09), which stays inert on this
deploy. Paste-string and `?source=<bpstring>` work regardless. The README's
host table is the user-facing version of this list.

## What you must configure in GitHub (cannot be done from code)

GitHub Pages source, Actions enablement, and the repo homepage are **repository
settings**. A workflow can push `gh-pages`; it cannot flip these on a fresh
fork. Do them as the repo owner.

### 1. Allow GitHub Actions

Forks often ship with Actions off, so the deploy workflows never register
(`Settings → Actions → General` shows no runs).

1. Open https://github.com/TimothyYao/factorio-blueprint-editor-universal/settings/actions
2. Under **Actions permissions**, choose **Allow all actions and reusable workflows**
   (or at least allow the actions these workflows pin:
   `actions/checkout`, `actions/setup-node`,
   `JamesIves/github-pages-deploy-action`, `rossjrw/pr-preview-action`).
3. Save. If GitHub asks you to enable Actions on the fork, confirm.

### 2. Run a production deploy so `gh-pages` exists

The Pages dropdown only lists branches that already exist. After Actions are on:

1. Merge this change to `master`, **or** open
   https://github.com/TimothyYao/factorio-blueprint-editor-universal/actions/workflows/pages-prod.yml
   and run **Deploy production site** via **Run workflow**.
2. Wait until the job is green. `gh-pages` should now exist:
   https://github.com/TimothyYao/factorio-blueprint-editor-universal/tree/gh-pages

### 3. Point Pages at the `gh-pages` branch

1. Open https://github.com/TimothyYao/factorio-blueprint-editor-universal/settings/pages
2. **Build and deployment → Source:** **Deploy from a branch**
   (not "GitHub Actions" — these workflows push a branch, they do not use
   `actions/deploy-pages`).
3. **Branch:** `gh-pages` / `/ (root)`.
4. Save. After a minute the site is
   https://timothyyao.github.io/factorio-blueprint-editor-universal/

If the page 404s with empty CSS/JS, `PUBLIC_BASE` does not match the repo name —
check the workflow's build logs for `base: '/factorio-blueprint-editor-universal/'`.

### 4. Website button on the repo

The About "Website" link is also a setting (this repo still inherited the
parent's `https://trisiak.github.io/factorio-blueprint-editor/`).

**UI:** repo home → gear next to **About** → **Website** →
`https://timothyyao.github.io/factorio-blueprint-editor-universal/`

**CLI** (owner machine, not something agents can do with a read-only `gh`):

```bash
gh repo edit TimothyYao/factorio-blueprint-editor-universal \
  --homepage "https://timothyyao.github.io/factorio-blueprint-editor-universal/"
```

### 5. Optional: Firebase authorized domain

Cloud library sign-in only matters if the `VITE_FIREBASE_*` repo **variables**
are set. If you enable them, add `timothyyao.github.io` under Firebase
**Authentication → Settings → Authorized domains**. See
[`blueprint-library.md`](./blueprint-library.md).

## What stays on the parent / original

Do **not** retarget these at this repo:

- Pack data and `packs.json` — `trisiak/factorio-pack-data`
- Historical issue numbers in `docs/` (`#28`, `#87`, …) — those tickets live
  on `trisiak/factorio-blueprint-editor`
- Original credits, Factorio art-asset notice, and the upstream Discord
