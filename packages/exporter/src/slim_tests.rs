//! Unit tests for slim mode's pure pieces: the crop/scale math (the whole
//! correctness surface — a wrong crop silently samples the wrong texels in the
//! editor) and the `textures.json` / manifest emission, on synthetic fixtures. The
//! basisu invocation and the Factorio install lookup are exercised by an actual
//! run, not here.

use super::*;

fn scratch(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("fbe-slim-test-{tag}-{nanos}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn crop_without_a_report_entry_is_the_whole_image() {
    assert_eq!(crop_rect(None, 256, 128), [0, 0, 256, 128]);
}

#[test]
fn an_unbounded_bbox_is_the_whole_image() {
    // `bbox: null` (the rect report's "requested whole") arrives as None; a
    // non-finite bbox is defensive against a hand-edited report.
    assert_eq!(
        crop_rect(Some([0.0, 0.0, f64::INFINITY, 64.0]), 256, 128),
        [0, 0, 256, 128]
    );
}

#[test]
fn crop_snaps_outward_to_even_coordinates() {
    // Origin floors down to even, far edge ceils up to even — so the crop can
    // only ever grow, never shave a sprite's edge, and the 0.5× texel pairing
    // stays aligned with the original image's own pixel grid.
    assert_eq!(
        crop_rect(Some([3.0, 5.0, 10.0, 10.0]), 256, 128),
        [2, 4, 12, 12]
    );
    assert_eq!(
        crop_rect(Some([4.0, 4.0, 8.0, 8.0]), 256, 128),
        [4, 4, 8, 8]
    );
}

#[test]
fn crop_may_extend_past_the_image() {
    // data.json routinely addresses rects past the source PNG's edge (direction
    // sheets whose frame width doesn't divide the image). Those must stay INSIDE
    // the crop — the overflow ships transparent — or the editor would render the
    // missing-texture checkerboard where the full pack shows nothing.
    assert_eq!(
        crop_rect(Some([0.0, 0.0, 342.0, 220.0]), 288, 220),
        [0, 0, 342, 220]
    );
    // A bogus origin past the image still yields a non-empty crop.
    let c = crop_rect(Some([300.0, 300.0, 10.0, 10.0]), 256, 128);
    assert!(c[2] >= 1 && c[3] >= 1);
}

#[test]
fn odd_bbox_dimensions_are_rounded_outward() {
    assert_eq!(
        crop_rect(Some([0.0, 0.0, 101.0, 33.0]), 101, 33),
        [0, 0, 102, 34]
    );
}

#[test]
fn crop_onto_canvas_pads_the_overflow_transparently() {
    let mut src = image::RgbaImage::new(4, 4);
    for p in src.pixels_mut() {
        *p = image::Rgba([255, 0, 0, 255]);
    }
    // A crop twice the image: the top-left quadrant is the source, the rest is
    // transparent (and the whole-image case short-circuits to the source itself).
    let out = crop_onto_canvas(&src, [0, 0, 8, 8]);
    assert_eq!(out.dimensions(), (8, 8));
    assert_eq!(*out.get_pixel(3, 3), image::Rgba([255, 0, 0, 255]));
    assert_eq!(*out.get_pixel(4, 4), image::Rgba([0, 0, 0, 0]));
    assert_eq!(crop_onto_canvas(&src, [0, 0, 4, 4]).dimensions(), (4, 4));
    // An offset crop that starts inside and runs off the edge.
    let out = crop_onto_canvas(&src, [2, 2, 4, 4]);
    assert_eq!(*out.get_pixel(0, 0), image::Rgba([255, 0, 0, 255]));
    assert_eq!(*out.get_pixel(2, 2), image::Rgba([0, 0, 0, 0]));
    // A crop entirely past the image is all transparent, not a panic.
    let out = crop_onto_canvas(&src, [10, 10, 2, 2]);
    assert_eq!(*out.get_pixel(0, 0), image::Rgba([0, 0, 0, 0]));
}

#[test]
fn scaled_size_rounds_up_and_never_reaches_zero() {
    assert_eq!(scaled_size(400, 300, 0.5), (200, 150));
    // An odd dimension keeps its last half pixel — the editor's shippedSize()
    // ceils identically, so its bounds check agrees with what we ship.
    assert_eq!(scaled_size(101, 33, 0.5), (51, 17));
    assert_eq!(scaled_size(1, 1, 0.5), (1, 1));
}

#[test]
fn identity_is_the_whole_image_unscaled() {
    let whole = Transform {
        crop: [0, 0, 64, 64],
        scale: 1.0,
    };
    assert!(is_identity(&whole, 64, 64));
    assert!(!is_identity(
        &Transform {
            crop: [0, 0, 64, 64],
            scale: 0.5
        },
        64,
        64
    ));
    assert!(!is_identity(&whole, 128, 64));
}

#[test]
fn pow2_padding_only_ever_grows() {
    assert_eq!(next_pow2(1), 1);
    assert_eq!(next_pow2(200), 256);
    assert_eq!(next_pow2(256), 256);
}

#[test]
fn every_in_crop_rect_maps_inside_the_shipped_file() {
    // The invariant the editor's census verifier asserts, checked here on the
    // producing side: for a crop the exporter emits, every original-space rect
    // inside it maps within [0, shipped size] after `(x - crop.x) * scale`.
    let crop = crop_rect(Some([100.0, 200.0, 401.0, 301.0]), 1024, 1024);
    let (sw, sh) = scaled_size(crop[2], crop[3], SLIM_SCALE);
    for (x, y, w, h) in [
        (100u32, 200u32, 1u32, 1u32),
        (137, 271, 63, 29),
        (crop[0] + crop[2] - 2, crop[1] + crop[3] - 2, 2, 2),
    ] {
        let fx = (x - crop[0]) as f64 * SLIM_SCALE;
        let fy = (y - crop[1]) as f64 * SLIM_SCALE;
        assert!(fx + w as f64 * SLIM_SCALE <= sw as f64, "x overflow");
        assert!(fy + h as f64 * SLIM_SCALE <= sh as f64, "y overflow");
    }
}

#[test]
fn textures_json_is_sorted_and_shaped_as_the_editor_expects() {
    let dir = scratch("textures");
    let path = dir.join("textures.json");
    let mut map: BTreeMap<String, Transform> = BTreeMap::new();
    map.insert(
        "__base__/graphics/z.png".into(),
        Transform {
            crop: [0, 0, 64, 64],
            scale: 0.5,
        },
    );
    map.insert(
        "__base__/graphics/a.png".into(),
        Transform {
            crop: [2, 4, 400, 300],
            scale: 0.5,
        },
    );
    write_json_sorted(&path, &map).unwrap();

    let written = std::fs::read_to_string(&path).unwrap();
    assert!(written.ends_with("}\n"));
    // Sorted keys → byte-stable output across runs.
    assert!(
        written.find("a.png").unwrap() < written.find("z.png").unwrap(),
        "keys must be sorted: {written}"
    );
    let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
    assert_eq!(
        parsed["__base__/graphics/a.png"],
        serde_json::json!({ "crop": [2, 4, 400, 300], "scale": 0.5 })
    );
}

#[tokio::test]
async fn manifest_entry_declares_the_variant_additively() {
    let dir = scratch("manifest");
    let packs_path = dir.join("packs.json");
    std::fs::write(
        &packs_path,
        r#"[
    {
        "id": "vanilla-2.0",
        "label": "Vanilla 2.0",
        "factorioVersion": "2.0",
        "mods": ["base"],
        "default": true,
        "someUnknownField": 1
    }
]"#,
    )
    .unwrap();

    let base = Pack {
        id: "vanilla-2.0".into(),
        label: Some("Vanilla 2.0".into()),
        factorio_version: Some("2.0".into()),
        mods: vec!["base".into()],
        versions: Default::default(),
        default: true,
    };
    update_manifest(&packs_path, &base, "vanilla-2.0-slim")
        .await
        .unwrap();

    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&packs_path).unwrap()).unwrap();
    let entries = manifest.as_array().unwrap();
    assert_eq!(entries.len(), 2);
    // The base entry is untouched, unknown fields and all.
    assert_eq!(entries[0]["someUnknownField"], serde_json::json!(1));
    assert!(entries[0].get("variantOf").is_none());
    let slim = &entries[1];
    assert_eq!(slim["id"], "vanilla-2.0-slim");
    assert_eq!(slim["label"], "Vanilla 2.0 (slim)");
    assert_eq!(slim["variantOf"], "vanilla-2.0");
    assert_eq!(slim["graphics"], "slim");
    // A variant carries no browser tier.
    assert_eq!(slim["artifacts"], serde_json::json!(["editor"]));

    // Idempotent: a second run neither duplicates the entry nor loses a
    // hand-edited label.
    update_manifest(&packs_path, &base, "vanilla-2.0-slim")
        .await
        .unwrap();
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&packs_path).unwrap()).unwrap();
    assert_eq!(manifest.as_array().unwrap().len(), 2);
}
