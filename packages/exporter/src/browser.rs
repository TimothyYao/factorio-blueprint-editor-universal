//! The browser artifact pipeline: `data/output/<pack-id>/browser/` =
//! `catalog.json` + `icons.webp` + `icons.json`, plus the additive `packs.json`
//! manifest fields. It is built from Factorio's own dump flags (never from the
//! injected `export-data` mod, which stays the editor artifact's source):
//!
//! 1. `--dump-data`           → `script-output/data-raw-dump.json`  (the catalog)
//! 2. `--dump-prototype-locale` → `script-output/<cat>-locale.json` (names/descs)
//! 3. `--dump-icon-sprites`   → `script-output/<folder>/<name>.png` (the sheet)
//!
//! The three are separate Factorio runs (the flags don't combine), and
//! `--dump-icon-sprites` needs a graphics backend — see the crate README (run
//! under `xvfb-run` on a headless box). Factorio's exit code is not a reliable
//! success signal (the icon dump can crash on shutdown *after* writing every
//! file), so each run is verified by checking its expected outputs appeared, not
//! by the exit status — mirroring the editor pipeline's `error("!EXIT!")` dance.

use serde::Serialize;
use std::collections::HashSet;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;

use crate::setup::{self, Pack};

mod catalog;
mod icons;

use catalog::{DumpLocale, LocaleCategory, ModRef, PackMeta};

/// Locale categories the catalog draws names/descriptions from, and the icon
/// folders it references. One list drives the dump verification and the loaders.
const CATEGORIES: [&str; 4] = ["item", "fluid", "recipe", "technology"];

/// Build the browser artifact for `pack` and update the shared manifest. Assumes
/// the Factorio install and this pack's mod set are already in place (the caller
/// runs `download_factorio` / `download_portal_mods` and either `extract` or
/// `prepare_export_data_mod` first).
pub async fn run_browser(
    output_dir: &Path,
    base_factorio_dir: &Path,
    pack: &Pack,
    all_mods: &[String],
    packs_path: &Path,
) -> Result<(), Box<dyn Error>> {
    let factorio_data = base_factorio_dir.join("data");
    let mods_root = base_factorio_dir.join("mods");
    let script_output = base_factorio_dir.join("script-output");
    let factorio_exe = base_factorio_dir.join("bin/x64/factorio");
    let browser_dir = output_dir.join("browser");

    println!("Building browser artifact for pack '{}'", pack.id);

    // --- 1. Run the three dumps (stale-delete first, verify outputs after) ----
    // The dumps must see exactly the pack's declared mod set: rewrite
    // mod-list.json with the injected export-data mod DISABLED (it pollutes
    // data.raw with placeholder prototypes — see write_mod_list). A later editor
    // run re-enables it via prepare_export_data_mod/extract.
    setup::write_mod_list(&mods_root, pack, all_mods, false).await?;
    run_dumps(&factorio_exe, &script_output).await?;

    // --- 2. Parse data-raw-dump.json (big; streamed off a buffered reader) -----
    let data_raw_path = script_output.join("data-raw-dump.json");
    let raw = load_data_raw(&data_raw_path)?;

    // --- 3. Locale: engine-dumped names/descriptions, .cfg map as fallback -----
    let dump_locale = load_dump_locale(&script_output).await?;
    let cfg_locale = setup::generate_locale_map(&factorio_data, &mods_root, &pack.mods).await?;

    // --- 4. Pack metadata (id/label/version from manifest, mods from info.json)
    let generated = iso8601_utc(now_secs());
    let mods = resolve_mod_versions(&factorio_data, &mods_root, &pack.mods).await?;
    let meta = PackMeta {
        id: pack.id.clone(),
        label: pack.label.clone().unwrap_or_else(|| pack.id.clone()),
        factorio_version: pack.factorio_version.clone().unwrap_or_default(),
        generated: generated.clone(),
        mods,
    };

    // --- 5. Build the catalog -------------------------------------------------
    let (mut cat, counts) = catalog::build_catalog(&raw, &dump_locale, &cfg_locale, &meta)?;
    println!(
        "Catalog: {} items, {} fluids, {} recipes, {} technologies \
         (excluded hidden: {} items, {} fluids, {} recipes, {} technologies)",
        cat.items.len(),
        cat.fluids.len(),
        cat.recipes.len(),
        cat.technologies.len(),
        counts.items,
        counts.fluids,
        counts.recipes,
        counts.technologies,
    );

    // --- 5b. Recipes without an own icon still have a game-composed effective
    // icon in the dump: --dump-icon-sprites renders EVERY recipe, applying the
    // main-product fallback itself. Prefer those renders, so a recipe whose
    // products are all hidden (rocket-part) doesn't reach consumers icon-less;
    // the consumer-side first-result fallback remains for anything the dump
    // didn't render. Content-dedup collapses the duplicates on the sheet.
    let filled = fill_recipe_icons_from_dump(&mut cat.recipes, &script_output.join("recipe"));
    if filled > 0 {
        println!("Filled {filled} recipe icon(s) from the dump's composed renders");
    }

    // --- 6. Compose the icon sheet, resolve missing icons ---------------------
    let icon_ids = catalog::referenced_icon_ids(&cat);
    let (icon_sheet, missing) = icons::compose_icons(&icon_ids, &script_output, &browser_dir)?;
    if !missing.is_empty() {
        apply_missing_icons(&mut cat, &missing);
    }
    // Fail-fast invariant: every iconId still referenced by the catalog resolves.
    verify_icon_coverage(&cat, &icon_sheet)?;

    // --- 7. Write catalog.json + icons.json -----------------------------------
    tokio::fs::create_dir_all(&browser_dir).await?;
    write_json_pretty(&browser_dir.join("catalog.json"), &cat)?;
    write_json_pretty(&browser_dir.join("icons.json"), &icon_sheet)?;
    println!(
        "Wrote {}/{{catalog.json, {}, icons.json}}",
        browser_dir.display(),
        icon_sheet.sheet.file
    );

    // --- 8. Additive manifest update ------------------------------------------
    update_manifest(packs_path, output_dir, &pack.id, &generated).await?;

    println!("Browser artifact done for pack '{}'", pack.id);
    Ok(())
}

/// Point every icon-less recipe at the dump's `recipe/<id>.png` when that
/// render exists. Returns how many were filled.
fn fill_recipe_icons_from_dump(recipes: &mut [catalog::Recipe], recipe_dir: &Path) -> usize {
    let mut filled = 0;
    for r in recipes {
        if r.icon_id.is_none() && recipe_dir.join(format!("{}.png", r.id)).is_file() {
            r.icon_id = Some(format!("recipe/{}", r.id));
            filled += 1;
        }
    }
    filled
}

/// Split `missing` iconIds by kind and apply the contract's fallbacks: recipe
/// own-icons missing → clear the recipe's iconId (consumer falls back to the
/// first result); item/fluid/technology icons missing → loud warning + exclude
/// the entry (an excluded entry beats a dangling icon reference).
fn apply_missing_icons(cat: &mut catalog::Catalog, missing: &HashSet<String>) {
    let (recipe_missing, other_missing): (HashSet<String>, HashSet<String>) = missing
        .iter()
        .cloned()
        .partition(|id| id.starts_with("recipe/"));

    if !recipe_missing.is_empty() {
        let mut list: Vec<&String> = recipe_missing.iter().collect();
        list.sort();
        println!(
            "NOTE: {} recipe icon(s) absent from the dump — falling back to product icon: {}",
            recipe_missing.len(),
            list.iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        catalog::clear_missing_recipe_icons(cat, &recipe_missing);
    }
    if !other_missing.is_empty() {
        let mut list: Vec<&String> = other_missing.iter().collect();
        list.sort();
        eprintln!(
            "WARNING: {} icon(s) absent from the dump — EXCLUDING those catalog entries: {}",
            other_missing.len(),
            list.iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        let cascade = catalog::exclude_missing_icons(cat, &other_missing);
        if cascade.recipes_dropped
            + cascade.producer_refs_pruned
            + cascade.unlock_refs_pruned
            + cascade.prerequisite_refs_pruned
            > 0
        {
            eprintln!(
                "WARNING: exclusion cascade: {} recipe(s) dropped, {} producer ref(s), \
                 {} unlock ref(s), {} prerequisite ref(s) pruned",
                cascade.recipes_dropped,
                cascade.producer_refs_pruned,
                cascade.unlock_refs_pruned,
                cascade.prerequisite_refs_pruned,
            );
        }
    }
}

/// Every iconId the (post-exclusion) catalog references must have a rect in
/// icons.json — the contract's core invariant. A miss here is a bug, not a data
/// problem, so it aborts.
fn verify_icon_coverage(
    cat: &catalog::Catalog,
    sheet: &icons::IconSheet,
) -> Result<(), Box<dyn Error>> {
    for id in catalog::referenced_icon_ids(cat) {
        if !sheet.icons.contains_key(&id) {
            return Err(format!(
                "internal error: catalog references iconId {id:?} with no rect in icons.json"
            )
            .into());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Dump invocation
// ---------------------------------------------------------------------------

/// Run all three dumps in order, each preceded by stale-output deletion and
/// followed by output verification.
async fn run_dumps(exe: &Path, script_output: &Path) -> Result<(), Box<dyn Error>> {
    // 1. data-raw-dump.json (the stale-delete target and the expected output are
    //    the same file).
    let data_raw = [script_output.join("data-raw-dump.json")];
    run_dump(exe, "--dump-data", &data_raw, &data_raw, false).await?;

    // 2. <cat>-locale.json — delete the ones we read; require item + recipe (the
    //    two categories any pack has; fluid/technology are tolerated absent).
    let locale_files: Vec<PathBuf> = CATEGORIES
        .iter()
        .map(|c| script_output.join(format!("{c}-locale.json")))
        .collect();
    let locale_required = vec![
        script_output.join("item-locale.json"),
        script_output.join("recipe-locale.json"),
    ];
    run_dump(
        exe,
        "--dump-prototype-locale",
        &locale_files,
        &locale_required,
        false,
    )
    .await?;

    // 3. <folder>/<name>.png — delete the folders we read; require the item
    //    folder to exist and be non-empty. Needs a graphics backend.
    let icon_dirs: Vec<PathBuf> = CATEGORIES.iter().map(|c| script_output.join(c)).collect();
    run_dump_icons(exe, &icon_dirs, &script_output.join("item")).await?;
    Ok(())
}

/// Run one file/locale dump: delete `stale`, launch Factorio with `flag`, then
/// verify each path in `expected` now exists (the reliable success signal).
async fn run_dump(
    exe: &Path,
    flag: &str,
    stale: &[PathBuf],
    expected: &[PathBuf],
    needs_display: bool,
) -> Result<(), Box<dyn Error>> {
    for p in stale {
        remove_path(p).await?;
    }
    println!("Running `factorio {flag}` …");
    let out = Command::new(exe).arg(flag).output().await?;
    for e in expected {
        if !e.exists() {
            return Err(dump_failure(flag, e, needs_display, &out.stdout));
        }
    }
    Ok(())
}

/// Run the icon-sprite dump: delete the folders we consume, launch Factorio, then
/// verify the item folder came out non-empty. Always flagged as needing a display
/// so the failure message points at the graphics-backend requirement.
async fn run_dump_icons(
    exe: &Path,
    stale_dirs: &[PathBuf],
    require_nonempty: &Path,
) -> Result<(), Box<dyn Error>> {
    for d in stale_dirs {
        remove_path(d).await?;
    }
    println!("Running `factorio --dump-icon-sprites` … (needs a graphics backend; see README)");
    let out = Command::new(exe)
        .arg("--dump-icon-sprites")
        .output()
        .await?;
    if !dir_is_nonempty(require_nonempty).await? {
        return Err(dump_failure(
            "--dump-icon-sprites",
            require_nonempty,
            true,
            &out.stdout,
        ));
    }
    Ok(())
}

/// Build a fail-fast error for a dump that didn't produce its expected output,
/// naming the missing path and (for the icon dump) the graphics-backend caveat,
/// with the tail of Factorio's stdout for diagnosis.
fn dump_failure(flag: &str, missing: &Path, needs_display: bool, stdout: &[u8]) -> Box<dyn Error> {
    let tail = tail_lines(&String::from_utf8_lossy(stdout), 25);
    let hint = if needs_display {
        "\n(--dump-icon-sprites needs a graphics backend — on a headless box run the \
         exporter under `xvfb-run`; see the README.)"
    } else {
        ""
    };
    format!(
        "`factorio {flag}` did not produce {}: expected output missing.{hint}\n\
         --- end of Factorio output ---\n{tail}",
        missing.display()
    )
    .into()
}

/// Remove a file or directory if it exists (stale-dump cleanup).
async fn remove_path(path: &Path) -> Result<(), Box<dyn Error>> {
    match tokio::fs::metadata(path).await {
        Ok(m) if m.is_dir() => tokio::fs::remove_dir_all(path).await?,
        Ok(_) => tokio::fs::remove_file(path).await?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

async fn dir_is_nonempty(dir: &Path) -> Result<bool, Box<dyn Error>> {
    match tokio::fs::read_dir(dir).await {
        Ok(mut entries) => Ok(entries.next_entry().await?.is_some()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

fn tail_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/// Parse `data-raw-dump.json` into the typed partial view. Streamed through a
/// buffered reader (the file can be hundreds of MB for modded packs).
fn load_data_raw(path: &Path) -> Result<catalog::DataRaw, Box<dyn Error>> {
    let file =
        std::fs::File::open(path).map_err(|e| format!("failed to open {}: {e}", path.display()))?;
    let reader = std::io::BufReader::new(file);
    let raw: catalog::DataRaw = serde_json::from_reader(reader)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))?;
    Ok(raw)
}

/// Load the `<cat>-locale.json` files. Each is `{ names: {...}, descriptions?:
/// {...} }`; an absent file (mod disabled) is tolerated as an empty category,
/// matching FactorioLab's ENOENT-swallowing reader.
async fn load_dump_locale(script_output: &Path) -> Result<DumpLocale, Box<dyn Error>> {
    let mut categories = std::collections::HashMap::new();
    for cat in CATEGORIES {
        let path = script_output.join(format!("{cat}-locale.json"));
        match tokio::fs::read_to_string(&path).await {
            Ok(s) => {
                let lc: LocaleCategory = serde_json::from_str(&s)
                    .map_err(|e| format!("failed to parse {}: {e}", path.display()))?;
                categories.insert(cat.to_string(), lc);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("failed to read {}: {e}", path.display()).into()),
        }
    }
    Ok(DumpLocale { categories })
}

/// The actually-loaded mod set with versions, read from each enabled mod's
/// `info.json` (game-shipped under `data/<mod>`, portal under `mods/<mod>`),
/// in manifest order. This is the pack's authoritative version list.
async fn resolve_mod_versions(
    factorio_data: &Path,
    mods_root: &Path,
    mods: &[String],
) -> Result<Vec<ModRef>, Box<dyn Error>> {
    let mut out = Vec::with_capacity(mods.len());
    for name in mods {
        let info_path = setup::mod_root(factorio_data, mods_root, name).join("info.json");
        let version = setup::get_info(&info_path)
            .await
            .map(|i| i.version)
            .map_err(|e| {
                format!(
                    "failed to read version of mod '{name}' ({}): {e}",
                    info_path.display()
                )
            })?;
        out.push(ModRef {
            name: name.clone(),
            version,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/// Additively update this pack's `packs.json` entry: `artifacts` (recomputed
/// truthfully — `"editor"` iff the pack has `data.json`, `"browser"` since this
/// run just produced it), `browserSchemaVersion: 1`, and `generated`. Unknown
/// fields and other packs are preserved; the write round-trips through
/// `serde_json::Value` (with `preserve_order`, so existing field order survives)
/// and is re-indented to the manifest's 4-space style.
async fn update_manifest(
    packs_path: &Path,
    output_dir: &Path,
    pack_id: &str,
    generated: &str,
) -> Result<(), Box<dyn Error>> {
    let contents = tokio::fs::read_to_string(packs_path)
        .await
        .map_err(|e| format!("failed to read {}: {e}", packs_path.display()))?;
    let mut manifest: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse {}: {e}", packs_path.display()))?;

    let entries = manifest
        .as_array_mut()
        .ok_or_else(|| format!("{} is not a JSON array", packs_path.display()))?;
    let entry = entries
        .iter_mut()
        .find(|e| e.get("id").and_then(|v| v.as_str()) == Some(pack_id))
        .ok_or_else(|| format!("pack '{pack_id}' not found in {}", packs_path.display()))?;
    let obj = entry.as_object_mut().ok_or_else(|| {
        format!(
            "pack '{pack_id}' entry in {} is not an object",
            packs_path.display()
        )
    })?;

    let has_editor = output_dir.join("data.json").exists();
    let mut artifacts: Vec<serde_json::Value> = Vec::new();
    if has_editor {
        artifacts.push("editor".into());
    }
    artifacts.push("browser".into());

    obj.insert("artifacts".to_string(), serde_json::Value::Array(artifacts));
    obj.insert(
        "browserSchemaVersion".to_string(),
        serde_json::Value::from(1),
    );
    obj.insert("generated".to_string(), serde_json::Value::from(generated));

    write_manifest_pretty(packs_path, &manifest)?;
    println!("Updated {} for pack '{pack_id}'", packs_path.display());
    Ok(())
}

/// Serialize `value` with 4-space indentation (matching the committed manifest)
/// and a trailing newline.
fn write_manifest_pretty(path: &Path, value: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let mut buf = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"    ");
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    value.serialize(&mut ser)?;
    buf.push(b'\n');
    write_atomic(path, &buf)
}

/// Write any serializable value as 2-space pretty JSON with a trailing newline.
fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), Box<dyn Error>> {
    let mut buf = serde_json::to_vec_pretty(value)?;
    buf.push(b'\n');
    write_atomic(path, &buf)
}

/// Write via a sibling `.tmp` + rename, so a crash mid-write can't leave a
/// truncated file. This matters most for `packs.json` — the committed manifest
/// both apps and the exporter itself read; `std::fs::write`'s truncate-then-write
/// would corrupt every pack's registry on an ill-timed kill, not just this run's.
fn write_atomic(path: &Path, buf: &[u8]) -> Result<(), Box<dyn Error>> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, buf).map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .map_err(|e| format!("failed to move {} into place: {e}", tmp.display()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Time (no chrono dependency)
// ---------------------------------------------------------------------------

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Format a Unix timestamp as an ISO-8601 UTC string (`YYYY-MM-DDTHH:MM:SSZ`).
/// Uses Howard Hinnant's `civil_from_days` so we don't pull in `chrono`.
fn iso8601_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Days since the Unix epoch → (year, month, day). Standard algorithm from
/// http://howardhinnant.github.io/date_algorithms.html (public domain).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests;
