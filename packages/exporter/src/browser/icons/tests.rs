//! Unit tests for icon-sheet composition, on tiny in-memory PNGs written to a
//! scratch dir (NO real game data). They pin the geometry FIB's CSS depends on:
//! content-dedup, rect placement on the 66 px stride, sheet dimensions, and the
//! missing-PNG signal.

use super::*;
use image::{Rgba, RgbaImage};
use std::path::PathBuf;

/// A unique scratch directory under the system temp dir.
fn scratch(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("fbe-icons-test-{tag}-{nanos}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Write a solid-color PNG at `script_output/<folder>/<name>.png`.
fn write_png(script_output: &Path, folder: &str, name: &str, color: [u8; 4]) {
    let mut img = RgbaImage::new(32, 32); // odd source size → exercises the resize
    for px in img.pixels_mut() {
        *px = Rgba(color);
    }
    let dir = script_output.join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    img.save(dir.join(format!("{name}.png"))).unwrap();
}

#[test]
fn dedup_rects_stride_and_dims() {
    let root = scratch("dedup");
    let script_output = root.join("script-output");
    let browser = root.join("browser");

    // a and b identical (red) → one tile; c distinct (blue) → a second tile.
    write_png(&script_output, "item", "a", [200, 0, 0, 255]);
    write_png(&script_output, "item", "b", [200, 0, 0, 255]);
    write_png(&script_output, "item", "c", [0, 0, 200, 255]);
    // A referenced icon with no PNG → reported missing, no rect.
    let ids = vec![
        "item/a".to_string(),
        "item/b".to_string(),
        "item/c".to_string(),
        "fluid/missing".to_string(),
    ];

    let (sheet, missing) = compose_icons(&ids, &script_output, &browser).unwrap();

    // Missing set is exactly the icon with no PNG.
    assert_eq!(missing.len(), 1);
    assert!(missing.contains("fluid/missing"));

    // Two unique tiles → 2 cells. cols = ceil(sqrt 2) = 2, rows = 1.
    assert_eq!(sheet.sheet.cell, 64);
    assert_eq!(sheet.sheet.padding, 2);
    assert_eq!(sheet.sheet.width, 132); // 2 * 66
    assert_eq!(sheet.sheet.height, 66); // 1 * 66
    assert_eq!(sheet.sheet.file, "icons.webp");

    // a and b dedup to the same first rect at (0,0); c to the next at (66,0).
    let a = sheet.icons.get("item/a").unwrap();
    let b = sheet.icons.get("item/b").unwrap();
    let c = sheet.icons.get("item/c").unwrap();
    assert_eq!((a.x, a.y), (0, 0));
    assert_eq!((b.x, b.y), (0, 0));
    assert_eq!((c.x, c.y), (66, 0));
    // The missing icon has no rect.
    assert!(!sheet.icons.contains_key("fluid/missing"));

    // The sheet file was written and decodes at the reported dimensions.
    let decoded = image::open(browser.join("icons.webp")).unwrap();
    assert_eq!(decoded.width(), 132);
    assert_eq!(decoded.height(), 66);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn near_square_layout() {
    let root = scratch("square");
    let script_output = root.join("script-output");
    let browser = root.join("browser");

    // 5 distinct tiles → cols = ceil(sqrt 5) = 3, rows = ceil(5/3) = 2.
    let colors = [
        [10, 0, 0, 255],
        [0, 20, 0, 255],
        [0, 0, 30, 255],
        [40, 40, 0, 255],
        [0, 50, 50, 255],
    ];
    let mut ids = Vec::new();
    for (i, c) in colors.iter().enumerate() {
        let name = format!("i{i}");
        write_png(&script_output, "item", &name, *c);
        ids.push(format!("item/{name}"));
    }

    let (sheet, missing) = compose_icons(&ids, &script_output, &browser).unwrap();
    assert!(missing.is_empty());
    assert_eq!(sheet.sheet.width, 3 * 66);
    assert_eq!(sheet.sheet.height, 2 * 66);
    // Last tile (index 4) is at col 1, row 1 → (66, 66).
    let last = sheet.icons.get("item/i4").unwrap();
    assert_eq!((last.x, last.y), (66, 66));

    std::fs::remove_dir_all(&root).ok();
}
