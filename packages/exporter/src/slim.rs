//! Slim mode: build a **graphics-only variant** of an already-generated pack
//! (`data/output/<pack>-slim/`) — see `docs/slim-graphics.md` in the repo root.
//!
//! A slim pack is the same game data with a smaller texture set:
//!
//! 1. the base pack's **byte-identical `data.json`** (so every sprite is still
//!    addressed in the ORIGINAL image's pixel space, and a blueprint made on
//!    either variant is native to the other),
//! 2. a `.basis` set built from the source PNGs **cropped to the rect report's
//!    union bbox** (dropping trailing animation frames and unused layers) and
//!    **downscaled 0.5×** (Factorio ships ~2× HR art, so this is roughly native
//!    resolution) — about a 4× saving before the crop even counts, and
//! 3. `textures.json`, the sidecar telling the editor how to map an original-space
//!    rect into the shipped file (`G.getTexture` applies it; a missing entry is
//!    the identity, which is why full packs are untouched by any of this).
//!
//! Inputs: `data/output/<pack>/data.json` (the base pack must already have been
//! generated) and a rect report from `npm run rect-report -- <pack> <out.json>`,
//! which replays the editor's own sprite census. Source PNGs are read from the
//! Factorio install exactly like the editor pipeline does (`setup::mod_root`) —
//! no re-download, no credentials, no Factorio launch.
//!
//! Files referenced by `data.json` but absent from the rect report (never sampled
//! by the census — UI-only art, unreferenced layers) are **kept, downscaled but
//! uncropped**, not dropped: the census covers what the editor *draws*, and a
//! dropped file that some code path does reach would be a visible hole, whereas
//! keeping it costs only the 4× downscale it gets anyway. The run log counts both
//! buckets.

use image::imageops::FilterType;
use indicatif::{ProgressBar, ProgressStyle};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tokio::process::Command;

use crate::browser::write_manifest_pretty;
use crate::setup::{self, Pack};

/// Downscale factor applied to every texture. A later compression-quality pass
/// (basisu settings) is an orthogonal knob; this one is the resolution.
const SLIM_SCALE: f64 = 0.5;

/// Suffix appended to the base pack's id to name the variant.
const SLIM_SUFFIX: &str = "-slim";

/// One rect-report entry. `bbox` is `null` when the file is requested WHOLE
/// somewhere (a zero-size `getTexture` call), which makes it uncroppable.
#[derive(Deserialize, Default)]
struct ReportEntry {
    bbox: Option<[f64; 4]>,
    #[serde(default)]
    #[allow(dead_code)] // informational in the report; not used by the build
    rects: u64,
}

type Report = HashMap<String, ReportEntry>;

/// Incremental-build stamp for one source PNG: `(len, mtime, crop, scale)`. The
/// crop and scale are part of it so an updated rect report rebuilds exactly the
/// textures whose crop moved, rather than everything or nothing.
type Stamp = (u64, u64, [u32; 4], f64);
type StampMap = HashMap<String, Stamp>;

/// One `textures.json` entry: the region of the ORIGINAL image this file holds,
/// and the factor applied after cropping.
#[derive(Serialize, PartialEq, Debug, Clone, Copy)]
struct Transform {
    crop: [u32; 4],
    scale: f64,
}

/// The crop rectangle to use for an image: the report's union bbox, or the whole
/// image when the file has no (or an unbounded) entry.
///
/// The rectangle is snapped OUTWARD to even coordinates. At 0.5× each shipped
/// texel covers an original pixel pair `(2i, 2i+1)`; an even crop origin keeps
/// that pairing aligned with the original image's own grid, so an even
/// original-space coordinate still lands on a whole texel. Snapping the far edge
/// outward (and the size to even) keeps the last column/row of a sprite instead of
/// shaving half a pixel off it.
///
/// The bbox is deliberately **not clamped to the image**: `data.json` routinely
/// addresses rects that run past the source PNG's edge (a 4-direction sheet whose
/// declared frame width doesn't divide the image exactly, e.g. base's electric
/// poles and inserter platforms). In the full pack those sample the transparent
/// power-of-two padding `make_img_pow2` adds; a crop clamped to the image would
/// put them out of bounds and render the missing-texture checkerboard instead.
/// The overflow is shipped as transparent pixels — the same thing the full pack
/// effectively serves — so the census invariant "every enumerated rect is inside
/// the crop" holds by construction.
fn crop_rect(bbox: Option<[f64; 4]>, img_w: u32, img_h: u32) -> [u32; 4] {
    let Some([x, y, w, h]) = bbox else {
        return [0, 0, img_w, img_h];
    };
    if !(x.is_finite() && y.is_finite() && w.is_finite() && h.is_finite()) {
        return [0, 0, img_w, img_h];
    }
    // Origin: floor, non-negative, snap DOWN to even.
    let x0 = (x.floor().max(0.0) as u32) & !1;
    let y0 = (y.floor().max(0.0) as u32) & !1;
    // Far edge: ceil, snap UP to even (`(v + 1) & !1`), at least one pixel.
    let x1 = ((((x + w).ceil().max(0.0) as u32) + 1) & !1).max(x0 + 2);
    let y1 = ((((y + h).ceil().max(0.0) as u32) + 1) & !1).max(y0 + 2);
    [x0, y0, x1 - x0, y1 - y0]
}

/// The shipped pixel size of a crop after downscaling. `ceil` (never zero) so an
/// odd crop dimension keeps its last half pixel — the editor's `shippedSize`
/// rounds the same way.
fn scaled_size(crop_w: u32, crop_h: u32, scale: f64) -> (u32, u32) {
    let w = ((crop_w as f64) * scale).ceil().max(1.0) as u32;
    let h = ((crop_h as f64) * scale).ceil().max(1.0) as u32;
    (w, h)
}

/// Whether a transform is a no-op (the whole image, unscaled). Such files are
/// omitted from `textures.json` — an absent entry IS the identity, so the sidecar
/// stays a description of what actually changed.
fn is_identity(t: &Transform, img_w: u32, img_h: u32) -> bool {
    t.scale == 1.0 && t.crop == [0, 0, img_w, img_h]
}

/// Cut `crop` out of `src` onto a transparent canvas of exactly the crop's size.
/// A plain `crop_imm` can't be used because a crop may extend past the source
/// image (see `crop_rect`); the part that does lands on transparent pixels, which
/// is what the full pack's power-of-two padding serves for the same rects.
fn crop_onto_canvas(src: &image::RgbaImage, crop: [u32; 4]) -> image::RgbaImage {
    let [cx, cy, cw, ch] = crop;
    let (img_w, img_h) = src.dimensions();
    if crop == [0, 0, img_w, img_h] {
        return src.clone();
    }
    let mut out = image::RgbaImage::new(cw, ch);
    // The overlapping region, if any (crop origins are never negative).
    let ow = img_w.saturating_sub(cx).min(cw);
    let oh = img_h.saturating_sub(cy).min(ch);
    if ow > 0 && oh > 0 {
        let part = image::imageops::crop_imm(src, cx, cy, ow, oh).to_image();
        image::imageops::replace(&mut out, &part, 0, 0);
    }
    out
}

/// Round up to the next power of two (basisu wants POT input; the existing editor
/// pipeline pads the same way, and padding only ever adds unused pixels to the
/// right/bottom, so it never affects the mapping).
fn next_pow2(v: u32) -> u32 {
    v.max(1).next_power_of_two()
}

/// One texture to build.
struct Job {
    /// Path as `data.json` spells it (`__base__/graphics/...png`) — the report key.
    rel: String,
    /// Source PNG in the Factorio install.
    src: PathBuf,
    /// Destination `.basis` under the slim pack.
    dst: PathBuf,
}

/// Result of building one texture (or of skipping it as unchanged).
struct Built {
    rel: String,
    transform: Transform,
    identity: bool,
    cropped: bool,
}

pub async fn run_slim(
    data_dir: &Path,
    base_factorio_dir: &Path,
    pack: &Pack,
    report_path: &Path,
    packs_path: &Path,
) -> Result<(), Box<dyn Error>> {
    let factorio_data = base_factorio_dir.join("data");
    let mods_root = base_factorio_dir.join("mods");
    let base_dir = data_dir.join("output").join(&pack.id);
    let slim_id = format!("{}{SLIM_SUFFIX}", pack.id);
    let out_dir = data_dir.join("output").join(&slim_id);

    println!("Building slim variant '{slim_id}' from pack '{}'", pack.id);

    // --- 1. The base pack's data.json, byte-identical ------------------------
    let data_json_path = base_dir.join("data.json");
    let content = tokio::fs::read(&data_json_path).await.map_err(|e| {
        format!(
            "failed to read {} — generate the base pack first: {e}",
            data_json_path.display()
        )
    })?;
    tokio::fs::create_dir_all(&out_dir).await?;
    tokio::fs::write(out_dir.join("data.json"), &content).await?;
    let content = String::from_utf8(content)?;

    // --- 2. The rect report --------------------------------------------------
    let report: Report = {
        let raw = tokio::fs::read_to_string(report_path).await.map_err(|e| {
            format!(
                "failed to read rect report {} — run `npm run rect-report -- {} <out.json>`: {e}",
                report_path.display(),
                pack.id
            )
        })?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("failed to parse {}: {e}", report_path.display()))?
    };
    println!("Rect report: {} file(s)", report.len());

    // --- 3. Every sprite data.json references (same regex as the editor tier) -
    lazy_static! {
        static ref IMG_REGEX: Regex = Regex::new(r#""([^"]+?\.png)""#).unwrap();
        static ref MOD_REF: Regex = Regex::new(r"^__([^_/][^/]*?)__/(.+)$").unwrap();
    }
    let mut rels: Vec<String> = IMG_REGEX
        .captures_iter(&content)
        .map(|cap| cap[1].to_string())
        .collect::<HashSet<String>>()
        .into_iter()
        .collect();
    // Deterministic order: the run log, the progress bar and any failure are
    // reproducible run to run.
    rels.sort();

    let mut jobs = Vec::with_capacity(rels.len());
    let mut missing = Vec::new();
    for rel in rels {
        let src = match MOD_REF.captures(&rel) {
            Some(cap) => setup::mod_root(&factorio_data, &mods_root, &cap[1]).join(&cap[2]),
            None => factorio_data.join(&rel),
        };
        let dst = out_dir.join(rel.replace(".png", ".basis").as_str());
        if tokio::fs::try_exists(&src).await? {
            jobs.push(Job { rel, src, dst });
        } else {
            missing.push(rel);
        }
    }
    if !missing.is_empty() {
        // Same posture as the editor tier: a modded dump can reference sprites
        // that never existed on disk. Loud, but not fatal.
        println!(
            "WARNING: {} referenced sprite(s) missing on disk (skipped):",
            missing.len()
        );
        for rel in &missing {
            println!("  {rel}");
        }
    }

    let referenced: HashSet<PathBuf> = jobs.iter().map(|j| j.dst.clone()).collect();

    // --- 4. Incremental state ------------------------------------------------
    // Keyed by source path, valued by (len, mtime, crop, scale): a texture is
    // rebuilt when the source changes OR when the report moves its crop, so an
    // updated rect report is picked up without a full rebuild.
    let metadata_path = out_dir.join("metadata.json");
    let old_metadata: StampMap = match tokio::fs::read_to_string(&metadata_path).await {
        Ok(buf) => serde_json::from_str(&buf).unwrap_or_default(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
        Err(e) => return Err(Box::new(e)),
    };
    let new_metadata = Arc::new(Mutex::new(HashMap::new()));

    // --- 5. Build -------------------------------------------------------------
    let progress = ProgressBar::new(jobs.len() as u64);
    progress.set_style(
        ProgressStyle::default_bar()
            .template("{wide_bar} {pos}/{len} ({elapsed})")
            .unwrap(),
    );

    let tmp_dir = std::env::temp_dir().join("__FBE_SLIM__");
    tokio::fs::create_dir_all(&tmp_dir).await?;

    let built = Arc::new(Mutex::new(Vec::<Built>::new()));
    let failures = Arc::new(Mutex::new(Vec::<String>::new()));
    let queue = Arc::new(Mutex::new(jobs));

    let parallelism = std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get);
    futures::future::try_join_all((0..parallelism).map(|_| {
        build_next(
            queue.clone(),
            &report,
            &tmp_dir,
            progress.clone(),
            &old_metadata,
            new_metadata.clone(),
            built.clone(),
            failures.clone(),
        )
    }))
    .await?;
    progress.finish();
    tokio::fs::remove_dir_all(&tmp_dir).await?;

    let failures = std::mem::take(&mut *failures.lock().unwrap());
    if !failures.is_empty() {
        // basisu failing on a texture leaves the pack incomplete — that's a build
        // error, not a data quirk.
        return Err(format!(
            "{} texture(s) failed to build:\n  {}",
            failures.len(),
            failures.join("\n  ")
        )
        .into());
    }

    let new_metadata = {
        let m = new_metadata.lock().unwrap();
        serde_json::to_vec(&*m)?
    };
    tokio::fs::write(metadata_path, new_metadata).await?;

    // --- 6. textures.json ----------------------------------------------------
    let built = std::mem::take(&mut *built.lock().unwrap());
    let mut transforms: BTreeMap<String, Transform> = BTreeMap::new();
    let (mut cropped, mut downscaled_only) = (0usize, 0usize);
    for b in &built {
        if b.identity {
            continue;
        }
        if b.cropped {
            cropped += 1;
        } else {
            downscaled_only += 1;
        }
        transforms.insert(b.rel.clone(), b.transform);
    }
    write_json_sorted(&out_dir.join("textures.json"), &transforms)?;

    // --- 7. Prune + manifest --------------------------------------------------
    let pruned = crate::setup::prune_unreferenced_basis(&out_dir, &referenced).await?;
    if pruned > 0 {
        println!("Pruned {pruned} unreferenced .basis file(s)");
    }
    update_manifest(packs_path, pack, &slim_id).await?;

    // --- 8. Run log -----------------------------------------------------------
    println!(
        "Slim pack '{slim_id}': {} texture(s) — {cropped} cropped + downscaled, \
         {downscaled_only} downscaled only (not in the rect report or uncroppable), \
         {} identity, {} missing on disk, 0 dropped",
        built.len(),
        built.len() - cropped - downscaled_only,
        missing.len(),
    );
    println!(
        "Wrote {}/{{data.json, textures.json ({} entries), *.basis}}",
        out_dir.display(),
        transforms.len()
    );
    Ok(())
}

/// Worker: pull jobs off the queue until it's empty.
#[allow(clippy::too_many_arguments)]
async fn build_next(
    queue: Arc<Mutex<Vec<Job>>>,
    report: &Report,
    tmp_dir: &Path,
    progress: ProgressBar,
    old_metadata: &StampMap,
    new_metadata: Arc<Mutex<StampMap>>,
    built: Arc<Mutex<Vec<Built>>>,
    failures: Arc<Mutex<Vec<String>>>,
) -> Result<(), Box<dyn Error>> {
    let next = || queue.lock().unwrap().pop();
    while let Some(job) = next() {
        match build_one(
            &job,
            report,
            tmp_dir,
            old_metadata,
            new_metadata.clone(),
            failures.clone(),
        )
        .await
        {
            Ok(b) => built.lock().unwrap().push(b),
            // Name the file: a decode failure is almost always a bad `__mod__`
            // mapping or a truncated install, and the path says which.
            Err(e) => return Err(format!("{}: {e}", job.src.display()).into()),
        }
        progress.inc(1);
    }
    Ok(())
}

async fn build_one(
    job: &Job,
    report: &Report,
    tmp_dir: &Path,
    old_metadata: &StampMap,
    new_metadata: Arc<Mutex<StampMap>>,
    failures: Arc<Mutex<Vec<String>>>,
) -> Result<Built, Box<dyn Error>> {
    let (img_w, img_h) = image::image_dimensions(&job.src)?;
    let bbox = report.get(&job.rel).and_then(|e| e.bbox);
    let crop = crop_rect(bbox, img_w, img_h);
    let transform = Transform {
        crop,
        scale: SLIM_SCALE,
    };
    let identity = is_identity(&transform, img_w, img_h);
    let cropped = crop != [0, 0, img_w, img_h];

    let key = job
        .src
        .to_str()
        .ok_or("PathBuf to &str failed")?
        .to_string();
    let (len, mtime) = len_and_mtime(&job.src).await?;
    let stamp = (len, mtime, crop, SLIM_SCALE);

    // Unchanged source AND unchanged crop, and the output is still there.
    let up_to_date = old_metadata.get(&key) == Some(&stamp) && job.dst.is_file();
    if !up_to_date {
        let (sw, sh) = scaled_size(crop[2], crop[3], SLIM_SCALE);
        let src = image::open(&job.src)?.to_rgba8();
        let cut = crop_onto_canvas(&src, crop);
        // Lanczos3: the sharpest of the crate's filters for a 2× reduction, which
        // matters for Factorio's high-contrast art.
        let small = image::imageops::resize(&cut, sw, sh, FilterType::Lanczos3);
        // basisu wants power-of-two input; pad at the right/bottom, which the
        // frame mapping never touches.
        let (pw, ph) = (next_pow2(sw), next_pow2(sh));
        let padded = if (pw, ph) == (sw, sh) {
            small
        } else {
            let mut out = image::RgbaImage::new(pw, ph);
            image::imageops::replace(&mut out, &small, 0, 0);
            out
        };

        let tmp_path = tmp_dir.join(&job.rel);
        tokio::fs::create_dir_all(tmp_path.parent().unwrap()).await?;
        padded.save_with_format(&tmp_path, image::ImageFormat::Png)?;

        tokio::fs::create_dir_all(job.dst.parent().unwrap()).await?;
        // Same basisu invocation as the editor tier — compression settings are a
        // separate, orthogonal knob.
        let status = Command::new("./basisu")
            .args(["-no_multithreading"])
            .args(["-mipmap"])
            .args(["-file", tmp_path.to_str().ok_or("PathBuf to &str failed")?])
            .args([
                "-output_file",
                job.dst.to_str().ok_or("PathBuf to &str failed")?,
            ])
            .stdout(std::process::Stdio::null())
            .spawn()?
            .wait()
            .await?;
        tokio::fs::remove_file(&tmp_path).await.ok();

        if !status.success() {
            failures.lock().unwrap().push(job.rel.clone());
            return Ok(Built {
                rel: job.rel.clone(),
                transform,
                identity,
                cropped,
            });
        }
    }

    new_metadata.lock().unwrap().insert(key, stamp);
    Ok(Built {
        rel: job.rel.clone(),
        transform,
        identity,
        cropped,
    })
}

async fn len_and_mtime(path: &Path) -> Result<(u64, u64), Box<dyn Error>> {
    let metadata = tokio::fs::metadata(path).await?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok((metadata.len(), mtime))
}

/// Write `textures.json`: 2-space pretty JSON, keys sorted (a `BTreeMap`), so the
/// file is byte-stable across runs and diffable between regenerations.
fn write_json_sorted<T: Serialize>(path: &Path, value: &T) -> Result<(), Box<dyn Error>> {
    let mut buf = serde_json::to_vec_pretty(value)?;
    buf.push(b'\n');
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &buf).map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .map_err(|e| format!("failed to move {} into place: {e}", tmp.display()))?;
    Ok(())
}

/// Add (or refresh) the variant's `packs.json` entry, additively and idempotently:
/// `variantOf` + `graphics` are what make the editor treat it as the same game
/// data as its base (canonical pack id), and `artifacts: ["editor"]` records that
/// a variant carries no `browser/` tier. Other entries are untouched.
async fn update_manifest(
    packs_path: &Path,
    base: &Pack,
    slim_id: &str,
) -> Result<(), Box<dyn Error>> {
    let contents = tokio::fs::read_to_string(packs_path)
        .await
        .map_err(|e| format!("failed to read {}: {e}", packs_path.display()))?;
    let mut manifest: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse {}: {e}", packs_path.display()))?;
    let entries = manifest
        .as_array_mut()
        .ok_or_else(|| format!("{} is not a JSON array", packs_path.display()))?;

    let label = format!(
        "{} (slim)",
        base.label.clone().unwrap_or_else(|| base.id.clone())
    );
    let existing = entries
        .iter_mut()
        .find(|e| e.get("id").and_then(|v| v.as_str()) == Some(slim_id));
    let entry = match existing {
        Some(e) => e,
        None => {
            entries.push(serde_json::json!({ "id": slim_id }));
            entries.last_mut().unwrap()
        }
    };
    let obj = entry
        .as_object_mut()
        .ok_or_else(|| format!("pack '{slim_id}' entry is not an object"))?;
    obj.entry("label").or_insert(label.into());
    obj.insert("variantOf".into(), base.id.clone().into());
    obj.insert("graphics".into(), "slim".into());
    if let Some(v) = &base.factorio_version {
        obj.entry("factorioVersion").or_insert(v.clone().into());
    }
    obj.insert(
        "artifacts".into(),
        serde_json::Value::Array(vec!["editor".into()]),
    );

    write_manifest_pretty(packs_path, &manifest)?;
    println!("Updated {} for pack '{slim_id}'", packs_path.display());
    Ok(())
}

#[cfg(test)]
#[path = "slim_tests.rs"]
mod tests;
