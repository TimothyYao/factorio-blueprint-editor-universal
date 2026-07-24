//! Unit tests for the orchestration helpers that don't need a Factorio run: the
//! additive manifest update (must preserve unknown fields and other packs) and
//! the chrono-free UTC timestamp formatting.

use super::*;

fn scratch(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("fbe-browser-test-{tag}-{nanos}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[tokio::test]
async fn manifest_additive_update_preserves_unknown_fields() {
    let root = scratch("manifest");
    let packs_path = root.join("packs.json");
    // Two packs; the target carries an unknown field and a `versions` map that
    // must survive. Field order is intentionally not alphabetical.
    let original = r#"[
    {
        "id": "vanilla-2.0",
        "label": "Vanilla 2.0",
        "factorioVersion": "2.0",
        "mods": ["base"],
        "default": true,
        "someUnknownField": { "keep": [1, 2, 3] }
    },
    {
        "id": "space-age",
        "label": "Space Age (2.0)",
        "mods": ["base", "space-age"]
    }
]"#;
    std::fs::write(&packs_path, original).unwrap();

    // Target pack has an editor artifact (data.json present).
    let output_dir = root.join("output/vanilla-2.0");
    std::fs::create_dir_all(&output_dir).unwrap();
    std::fs::write(output_dir.join("data.json"), "{}").unwrap();

    update_manifest(
        &packs_path,
        &output_dir,
        "vanilla-2.0",
        "2026-07-24T12:00:00Z",
    )
    .await
    .unwrap();

    let written = std::fs::read_to_string(&packs_path).unwrap();
    let manifest: serde_json::Value = serde_json::from_str(&written).unwrap();
    let entry = &manifest.as_array().unwrap()[0];

    // Added fields.
    assert_eq!(entry["artifacts"], serde_json::json!(["editor", "browser"]));
    assert_eq!(entry["browserSchemaVersion"], serde_json::json!(1));
    assert_eq!(
        entry["generated"],
        serde_json::json!("2026-07-24T12:00:00Z")
    );
    // Unknown / existing fields preserved.
    assert_eq!(
        entry["someUnknownField"]["keep"],
        serde_json::json!([1, 2, 3])
    );
    assert_eq!(entry["label"], serde_json::json!("Vanilla 2.0"));
    assert_eq!(entry["default"], serde_json::json!(true));
    // The other pack is untouched.
    let other = &manifest.as_array().unwrap()[1];
    assert_eq!(other["id"], serde_json::json!("space-age"));
    assert!(other.get("artifacts").is_none());

    // Field order preserved (preserve_order): id stays first, added keys appended.
    let keys: Vec<&str> = entry
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys[0], "id");
    assert_eq!(
        &keys[keys.len() - 3..],
        ["artifacts", "browserSchemaVersion", "generated"]
    );
    // 4-space indentation retained (array element object keys nest to 8 spaces,
    // matching the committed manifest's style).
    assert!(written.contains("\n        \"id\""));

    std::fs::remove_dir_all(&root).ok();
}

#[tokio::test]
async fn manifest_browser_only_when_no_editor_data() {
    let root = scratch("manifest-browser-only");
    let packs_path = root.join("packs.json");
    std::fs::write(&packs_path, r#"[{ "id": "p", "mods": [] }]"#).unwrap();
    // No data.json → no editor artifact.
    let output_dir = root.join("output/p");
    std::fs::create_dir_all(&output_dir).unwrap();

    update_manifest(&packs_path, &output_dir, "p", "2026-01-01T00:00:00Z")
        .await
        .unwrap();

    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&packs_path).unwrap()).unwrap();
    assert_eq!(
        manifest.as_array().unwrap()[0]["artifacts"],
        serde_json::json!(["browser"])
    );

    std::fs::remove_dir_all(&root).ok();
}

#[tokio::test]
async fn manifest_update_unknown_pack_fails() {
    let root = scratch("manifest-missing");
    let packs_path = root.join("packs.json");
    std::fs::write(&packs_path, r#"[{ "id": "a", "mods": [] }]"#).unwrap();
    let output_dir = root.join("output/x");
    std::fs::create_dir_all(&output_dir).unwrap();
    assert!(update_manifest(&packs_path, &output_dir, "missing", "t")
        .await
        .is_err());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn iso8601_formatting() {
    assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso8601_utc(1_609_459_200), "2021-01-01T00:00:00Z");
    assert_eq!(iso8601_utc(1_721_822_400), "2024-07-24T12:00:00Z");
}

#[test]
fn recipe_icons_filled_from_dump_renders() {
    let root = scratch("recipe-icons");
    // The dump rendered an effective icon for `covered` but not `uncovered`;
    // `own-icon` already points at its own icon and must not be touched.
    std::fs::write(root.join("covered.png"), b"png-bytes").unwrap();
    let mk = |id: &str, icon_id: Option<&str>| catalog::Recipe {
        id: id.to_string(),
        label: id.to_string(),
        description: None,
        time: serde_json::json!(0.5),
        category: "crafting".to_string(),
        ingredients: vec![],
        results: vec![],
        producers: vec![],
        icon_id: icon_id.map(|s| s.to_string()),
    };
    let mut recipes = vec![
        mk("covered", None),
        mk("uncovered", None),
        mk("own-icon", Some("recipe/own-icon")),
    ];
    let filled = fill_recipe_icons_from_dump(&mut recipes, &root);
    assert_eq!(filled, 1);
    assert_eq!(recipes[0].icon_id.as_deref(), Some("recipe/covered"));
    assert_eq!(recipes[1].icon_id, None); // consumer-side fallback remains
    assert_eq!(recipes[2].icon_id.as_deref(), Some("recipe/own-icon"));
    std::fs::remove_dir_all(&root).ok();
}
