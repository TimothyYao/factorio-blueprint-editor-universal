//! Compose the browser artifact's icon sheet (`icons.webp` + `icons.json`) from
//! the per-prototype PNGs `--dump-icon-sprites` renders. The geometry mirrors
//! FactorioLab's so FIB's percentage-based CSS math applies unchanged: 64 px
//! content cells on a 2 px gutter, i.e. a 66 px stride. Identical icons are
//! content-deduped (the recipe-icon == product-icon case, and shared item/fluid
//! glyphs) so many iconIds can map to one rect.

use image::{imageops, ExtendedColorType, ImageEncoder, RgbaImage};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::error::Error;
use std::path::Path;

/// Content cell size (px). Every dumped icon is normalized to this, matching
/// FactorioLab's `resize(64,64)`.
const CELL: u32 = 64;
/// Gutter between cells (px) — the FactorioLab-compatible padding FIB's CSS
/// depends on; stride is `CELL + PADDING` = 66.
const PADDING: u32 = 2;

/// The `icons.json` document.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconSheet {
    pub schema_version: u32,
    pub sheet: SheetMeta,
    pub icons: BTreeMap<String, Rect>,
}

#[derive(Serialize)]
pub struct SheetMeta {
    /// The sheet file actually written — `icons.webp`, or `icons.png` if WebP
    /// encoding failed. Consumers read this rather than hardcoding a name.
    pub file: String,
    pub width: u32,
    pub height: u32,
    pub cell: u32,
    pub padding: u32,
}

#[derive(Serialize, Clone, Copy)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
}

/// Split an iconId (`item/iron-plate`, `recipe/iron-gear-wheel`) into its dump
/// folder and prototype name. Names never contain `/`, so a single split on the
/// first slash is exact.
fn split_icon_id(icon_id: &str) -> Option<(&str, &str)> {
    icon_id.split_once('/')
}

/// Read a dumped icon PNG and normalize it to `CELL`×`CELL` RGBA. `Ok(None)`
/// means the PNG simply wasn't in the dump (a legitimate, expected outcome the
/// caller records as "missing"); `Err` means the file exists but couldn't be
/// decoded — a real problem worth aborting for.
fn load_icon(path: &Path) -> Result<Option<Vec<u8>>, Box<dyn Error>> {
    if !path.exists() {
        return Ok(None);
    }
    let img = image::open(path)
        .map_err(|e| format!("failed to decode icon {}: {e}", path.display()))?
        .to_rgba8();
    let resized = imageops::resize(&img, CELL, CELL, imageops::FilterType::Lanczos3);
    Ok(Some(resized.into_raw()))
}

/// Compose the sheet for exactly `icon_ids` (in the order given — the catalog's
/// display order, so layout is deterministic). Writes `icons.webp` (or
/// `icons.png` on WebP failure) into `browser_dir` and returns the `icons.json`
/// document plus the set of iconIds whose PNG was missing from the dump (the
/// caller resolves those: recipe icons fall back, others are excluded).
pub fn compose_icons(
    icon_ids: &[String],
    script_output: &Path,
    browser_dir: &Path,
) -> Result<(IconSheet, HashSet<String>), Box<dyn Error>> {
    // Content-dedup: unique 64×64 RGBA tiles, first-seen order; every present
    // iconId maps to a tile index.
    let mut unique: Vec<Vec<u8>> = Vec::new();
    let mut content_index: HashMap<Vec<u8>, usize> = HashMap::new();
    let mut id_index: Vec<(&str, usize)> = Vec::new();
    let mut missing: HashSet<String> = HashSet::new();

    for icon_id in icon_ids {
        let Some((folder, name)) = split_icon_id(icon_id) else {
            return Err(format!("malformed iconId {icon_id:?} (expected `folder/name`)").into());
        };
        let path = script_output.join(folder).join(format!("{name}.png"));
        match load_icon(&path)? {
            Some(bytes) => {
                let idx = match content_index.get(&bytes) {
                    Some(&i) => i,
                    None => {
                        let i = unique.len();
                        unique.push(bytes.clone());
                        content_index.insert(bytes, i);
                        i
                    }
                };
                id_index.push((icon_id.as_str(), idx));
            }
            None => {
                missing.insert(icon_id.clone());
            }
        }
    }

    // Near-square grid on a CELL+PADDING stride.
    let stride = CELL + PADDING;
    let n = unique.len().max(1) as u32; // guard the degenerate empty-pack case
    let cols = (n as f64).sqrt().ceil() as u32;
    let rows = n.div_ceil(cols);
    let width = cols * stride;
    let height = rows * stride;

    // Rect per unique tile, then paint each tile into the sheet.
    let mut sheet = RgbaImage::new(width, height);
    let mut tile_rects: Vec<Rect> = Vec::with_capacity(unique.len());
    for (i, bytes) in unique.iter().enumerate() {
        let col = i as u32 % cols;
        let row = i as u32 / cols;
        let x = col * stride;
        let y = row * stride;
        tile_rects.push(Rect { x, y });
        // from_raw can't fail: length is exactly CELL*CELL*4 by construction.
        let tile = RgbaImage::from_raw(CELL, CELL, bytes.clone())
            .ok_or("internal error: tile is not 64x64 RGBA")?;
        imageops::replace(&mut sheet, &tile, x as i64, y as i64);
    }

    // iconId → rect (BTreeMap ⇒ deterministic, sorted output keys).
    let mut icons: BTreeMap<String, Rect> = BTreeMap::new();
    for (id, idx) in id_index {
        icons.insert(id.to_string(), tile_rects[idx]);
    }

    tokio_write_dir(browser_dir)?;
    let file = write_sheet(&sheet, browser_dir)?;

    let doc = IconSheet {
        schema_version: 1,
        sheet: SheetMeta {
            file,
            width,
            height,
            cell: CELL,
            padding: PADDING,
        },
        icons,
    };
    Ok((doc, missing))
}

/// Ensure the output directory exists (sync — this whole module is CPU-bound and
/// runs off the async path).
fn tokio_write_dir(dir: &Path) -> Result<(), Box<dyn Error>> {
    std::fs::create_dir_all(dir)?;
    Ok(())
}

/// Write the composed sheet as lossless WebP; on any encoder error fall back to
/// PNG. Returns the file name written (so `icons.json`'s `sheet.file` stays
/// truthful).
fn write_sheet(sheet: &RgbaImage, browser_dir: &Path) -> Result<String, Box<dyn Error>> {
    let (width, height) = (sheet.width(), sheet.height());
    let mut buf: Vec<u8> = Vec::new();
    let webp_ok = image::codecs::webp::WebPEncoder::new_lossless(&mut buf)
        .write_image(sheet.as_raw(), width, height, ExtendedColorType::Rgba8)
        .is_ok();

    if webp_ok {
        std::fs::write(browser_dir.join("icons.webp"), &buf)?;
        Ok("icons.webp".to_string())
    } else {
        // Lossless PNG fallback — the file name flows through icons.json so
        // consumers don't care which encoder won.
        eprintln!("WARNING: WebP encoding failed; writing icons.png instead");
        sheet.save(browser_dir.join("icons.png"))?;
        Ok("icons.png".to_string())
    }
}

#[cfg(test)]
mod tests;
