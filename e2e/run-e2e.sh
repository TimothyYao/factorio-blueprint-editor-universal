#!/usr/bin/env bash
#
# Hardened Playwright launcher for constrained / rootless hosts.
#
# `npm run test:e2e` runs `playwright test` directly — all you need on a normal
# dev box or in CI. On a sandboxed host the *environment around* Playwright can be
# wrong in ways that make every spec die at browser launch (a ~3ms "Executable
# doesn't exist" / "Target crashed" before any test logic runs, which reads like a
# mass test failure but isn't). This wrapper heals the two we've hit, then forwards
# every argument to `playwright test` unchanged — so it's a transparent no-op
# wherever the environment is already fine, including CI:
#
#   npm run test:e2e:host -- --project=desktop-chromium --workers=1
#
# It never downloads anything (the browser CDN may sit outside a host's egress
# allowlist — see the "Browser" note in e2e/README.md). It only fixes how
# Playwright *finds* an already-installed browser and its system libraries.
set -euo pipefail

# Run from the repo root so Playwright resolves playwright.config.ts regardless of
# the caller's cwd (npm already cd's here; a direct `./e2e/run-e2e.sh` may not).
cd "$(dirname "$0")/.."

# 1) A stale PLAYWRIGHT_BROWSERS_PATH. If it's exported as an *absolute* path to a
#    directory that does not exist, Playwright dutifully looks for the browser
#    there, finds nothing, and fails at launch. Drop it so Playwright falls back to
#    its default cache (~/.cache/ms-playwright), where the browser usually already
#    lives. Only absolute paths are touched: the documented sentinel `0` (use the
#    copy under node_modules) and relative values are left for Playwright to resolve
#    against its own cwd — we don't second-guess those. (The `== /*` test is false
#    for an unset/empty var too, so no separate emptiness check is needed.)
if [[ "${PLAYWRIGHT_BROWSERS_PATH:-}" == /* && ! -d "${PLAYWRIGHT_BROWSERS_PATH}" ]]; then
    echo "run-e2e: PLAYWRIGHT_BROWSERS_PATH='${PLAYWRIGHT_BROWSERS_PATH}' does not exist — falling back to the default browser cache." >&2
    unset PLAYWRIGHT_BROWSERS_PATH
fi

# 2) Missing Chromium system libraries. On a host without root you can't
#    `playwright install --with-deps` (no apt), so headless_shell may be unable to
#    resolve libnss3 / libgbm / libX11 / … and the renderer dies at launch. If those
#    libs are staged somewhere, point the loader at that dir via PLAYWRIGHT_SYS_LIBS
#    — kept in your environment, never hard-coded here, so this stays host-agnostic:
#      export PLAYWRIGHT_SYS_LIBS=/path/to/staged/usr/lib/x86_64-linux-gnu
if [[ -n "${PLAYWRIGHT_SYS_LIBS:-}" ]]; then
    export LD_LIBRARY_PATH="${PLAYWRIGHT_SYS_LIBS}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
fi

# Heads-up, not a gate: the app is one software-rendered (SwiftShader, no GPU)
# WebGL canvas, which is memory-hungry. Under a tight cgroup memory cap the renderer
# gets OOM-killed on the canvas-heavy specs (library / modpack / persistence) as a
# "Target crashed" — even single-worker. Warn if the cap looks too low to be
# reliable so a crash here isn't mistaken for a code regression.
mem_max_file=/sys/fs/cgroup/memory.max
if [[ -r "${mem_max_file}" ]]; then
    mem_max=$(cat "${mem_max_file}")
    if [[ "${mem_max}" != "max" ]] && ((mem_max < 6 * 1024 * 1024 * 1024)); then
        echo "run-e2e: cgroup memory cap is $((mem_max / 1024 / 1024)) MiB (< 6 GiB); canvas-heavy specs may OOM-crash the renderer here — not a code regression." >&2
    fi
fi

# `--no-install` pins npx to the repo-local Playwright CLI (a devDependency, so
# `npm install` has already provided it) and makes it error out rather than fetch
# from the registry — keeping the wrapper network-free on constrained-egress hosts.
exec npx --no-install playwright test "$@"
