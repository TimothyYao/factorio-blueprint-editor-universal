//! Unit tests for the catalog builder, driven by tiny synthetic dump fixtures
//! (hand-written JSON — NO real game data). They pin the behaviors the FIB seam
//! relies on: display-order sorting, hidden filtering, producer derivation
//! (category match + fluid-box exclusion), technology normalization, default
//! application, locale precedence + rich-text stripping, and recipe-icon
//! fallback.

use super::*;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

fn raw(json: &str) -> DataRaw {
    serde_json::from_str(json).expect("fixture DataRaw should deserialize")
}

fn locale(
    cat: &str,
    names: &[(&str, &str)],
    descriptions: &[(&str, &str)],
) -> (String, LocaleCategory) {
    (
        cat.to_string(),
        LocaleCategory {
            names: names
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            descriptions: descriptions
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        },
    )
}

fn meta() -> PackMeta {
    PackMeta {
        id: "test-pack".to_string(),
        label: "Test Pack".to_string(),
        factorio_version: "2.0".to_string(),
        generated: "2026-07-24T12:00:00Z".to_string(),
        mods: vec![ModRef {
            name: "base".to_string(),
            version: "2.0.76".to_string(),
        }],
    }
}

fn find_item<'a>(cat: &'a Catalog, id: &str) -> &'a Item {
    cat.items
        .iter()
        .find(|i| i.id == id)
        .unwrap_or_else(|| panic!("no item {id}"))
}
fn find_recipe<'a>(cat: &'a Catalog, id: &str) -> &'a Recipe {
    cat.recipes
        .iter()
        .find(|r| r.id == id)
        .unwrap_or_else(|| panic!("no recipe {id}"))
}
fn find_tech<'a>(cat: &'a Catalog, id: &str) -> &'a Technology {
    cat.technologies
        .iter()
        .find(|t| t.id == id)
        .unwrap_or_else(|| panic!("no tech {id}"))
}

/// A rich fixture exercised by several tests: two groups, four subgroups, a
/// hidden item/fluid/recipe, three crafting machines (one fluid-capable, one not),
/// and recipes/techs covering the interesting cases.
const FIXTURE: &str = r#"{
  "item-group": {
    "logistics":             { "type": "item-group", "name": "logistics",             "order": "a" },
    "production":            { "type": "item-group", "name": "production",            "order": "b" },
    "intermediate-products": { "type": "item-group", "name": "intermediate-products", "order": "c" },
    "fluids":                { "type": "item-group", "name": "fluids",                "order": "e" }
  },
  "item-subgroup": {
    "raw-material":       { "type": "item-subgroup", "name": "raw-material",       "group": "intermediate-products", "order": "b" },
    "science-pack":       { "type": "item-subgroup", "name": "science-pack",       "group": "intermediate-products", "order": "y" },
    "production-machine": { "type": "item-subgroup", "name": "production-machine", "group": "production",            "order": "a" },
    "fluid":              { "type": "item-subgroup", "name": "fluid",              "group": "fluids",                "order": "a" }
  },
  "item": {
    "iron-plate":               { "type": "item", "name": "iron-plate",               "stack_size": 100, "subgroup": "raw-material", "order": "a[iron]" },
    "copper-plate":             { "type": "item", "name": "copper-plate",             "stack_size": 100, "subgroup": "raw-material", "order": "b[copper]" },
    "automation-science-pack":  { "type": "tool", "name": "automation-science-pack",  "stack_size": 200, "subgroup": "science-pack", "order": "a" },
    "assembling-machine-1":     { "type": "item", "name": "assembling-machine-1",     "stack_size": 50,  "subgroup": "production-machine", "order": "a", "place_result": "assembling-machine-1" },
    "chemical-plant":           { "type": "item", "name": "chemical-plant",           "stack_size": 50,  "subgroup": "production-machine", "order": "b", "place_result": "chemical-plant" },
    "no-fluid-crafter":         { "type": "item", "name": "no-fluid-crafter",         "stack_size": 50,  "subgroup": "production-machine", "order": "c", "place_result": "no-fluid-crafter" },
    "hidden-item":              { "type": "item", "name": "hidden-item",              "stack_size": 1,   "subgroup": "raw-material", "order": "z", "hidden": true },
    "flag-hidden-item":         { "type": "item", "name": "flag-hidden-item",         "stack_size": 1,   "subgroup": "raw-material", "order": "z", "flags": ["hidden"] }
  },
  "fluid": {
    "water":         { "type": "fluid", "name": "water",         "subgroup": "fluid", "order": "a" },
    "petroleum-gas": { "type": "fluid", "name": "petroleum-gas", "subgroup": "fluid", "order": "b" },
    "hidden-fluid":  { "type": "fluid", "name": "hidden-fluid",  "subgroup": "fluid", "order": "z", "hidden": true }
  },
  "assembling-machine": {
    "assembling-machine-1": { "type": "assembling-machine", "name": "assembling-machine-1", "crafting_categories": ["crafting"], "crafting_speed": 0.5, "energy_usage": "75kW", "module_slots": 2 },
    "chemical-plant":       { "type": "assembling-machine", "name": "chemical-plant",       "crafting_categories": ["chemistry"], "crafting_speed": 1, "energy_usage": "210kW", "module_slots": 3,
                              "fluid_boxes": [ { "production_type": "input" }, { "production_type": "input" }, { "production_type": "output" } ] },
    "no-fluid-crafter":     { "type": "assembling-machine", "name": "no-fluid-crafter",     "crafting_categories": ["chemistry"], "crafting_speed": 1, "energy_usage": "100kW" }
  },
  "recipe": {
    "iron-gear-wheel": { "type": "recipe", "name": "iron-gear-wheel",
      "ingredients": [ { "type": "item", "name": "iron-plate", "amount": 2 } ],
      "results":     [ { "type": "item", "name": "iron-gear-wheel", "amount": 1 } ] },
    "plastic-bar": { "type": "recipe", "name": "plastic-bar", "category": "chemistry", "energy_required": 1,
      "ingredients": [ { "type": "fluid", "name": "petroleum-gas", "amount": 20 }, { "type": "item", "name": "coal", "amount": 1 } ],
      "results":     [ { "type": "item", "name": "plastic-bar", "amount": 2 } ] },
    "uranium-processing": { "type": "recipe", "name": "uranium-processing", "category": "crafting",
      "ingredients": [ { "type": "item", "name": "uranium-ore", "amount": 10 } ],
      "results": [ { "type": "item", "name": "uranium-235", "amount": 1, "probability": 0.007 },
                   { "type": "item", "name": "uranium-238", "amount": 1, "probability": 0.993 } ] },
    "prob-one": { "type": "recipe", "name": "prob-one", "category": "crafting",
      "ingredients": [ { "type": "item", "name": "iron-plate", "amount": 1 } ],
      "results":     [ { "type": "item", "name": "prob-one", "amount": 1, "probability": 1.0 } ] },
    "range-recipe": { "type": "recipe", "name": "range-recipe", "category": "crafting",
      "ingredients": [ { "type": "item", "name": "iron-plate", "amount": 1 } ],
      "results":     [ { "type": "item", "name": "range-recipe", "amount_min": 1, "amount_max": 3 } ] },
    "default-amounts": { "type": "recipe", "name": "default-amounts", "category": "crafting",
      "ingredients": [ { "type": "item", "name": "iron-plate" } ],
      "results":     [ { "type": "item", "name": "default-amounts" } ] },
    "custom-icon-recipe": { "type": "recipe", "name": "custom-icon-recipe", "category": "crafting",
      "icon": "__base__/graphics/icons/custom.png",
      "ingredients": [ { "type": "item", "name": "iron-plate", "amount": 1 } ],
      "results":     [ { "type": "item", "name": "iron-gear-wheel", "amount": 1 } ] },
    "hidden-recipe": { "type": "recipe", "name": "hidden-recipe", "category": "crafting", "hidden": true,
      "ingredients": [], "results": [] }
  },
  "technology": {
    "automation": { "type": "technology", "name": "automation", "order": "a", "prerequisites": [],
      "unit": { "count": 10, "time": 15, "ingredients": [ ["automation-science-pack", 1] ] },
      "effects": [ { "type": "unlock-recipe", "recipe": "assembling-machine-1" },
                   { "type": "unlock-recipe", "recipe": "long-inserter" },
                   { "type": "character-inventory-slots-bonus", "modifier": 5 } ] },
    "steel-processing": { "type": "technology", "name": "steel-processing", "order": "b",
      "prerequisites": ["automation"],
      "research_trigger": { "type": "craft-item", "item": "iron-plate", "count": 50 },
      "effects": [ { "type": "unlock-recipe", "recipe": "steel-plate" } ] },
    "mining-productivity-infinite": { "type": "technology", "name": "mining-productivity-infinite", "order": "c",
      "max_level": "infinite",
      "unit": { "count_formula": "2^(L-6)*1000", "time": 60, "ingredients": [ ["automation-science-pack", 1] ] },
      "effects": [ { "type": "mining-drill-productivity-bonus", "modifier": 0.1 } ] },
    "hidden-tech": { "type": "technology", "name": "hidden-tech", "order": "z", "hidden": true }
  }
}"#;

fn build_fixture() -> (Catalog, ExclusionCounts) {
    let raw = raw(FIXTURE);
    let dl = DumpLocale {
        categories: [
            locale(
                "item",
                &[
                    ("iron-plate", "Iron plate"),
                    ("copper-plate", "Copper plate"),
                    ("water", "WRONG"),
                ],
                &[("iron-plate", "Made from [item=iron-ore] iron ore.")],
            ),
            locale(
                "fluid",
                &[("water", "Water"), ("petroleum-gas", "Petroleum gas")],
                &[],
            ),
            locale("recipe", &[("iron-gear-wheel", "Iron gear wheel")], &[]),
            locale(
                "technology",
                &[("automation", "Automation")],
                &[(
                    "automation",
                    "Unlocks [entity=assembling-machine-1] the machine.",
                )],
            ),
        ]
        .into_iter()
        .collect(),
    };
    // .cfg fallback: copper-plate has only a .cfg description; iron-plate also has
    // one, but the dump description must win (precedence test).
    let cfg: HashMap<String, String> = [
        (
            "item-description.copper-plate",
            "A [color=orange]copper[/color] plate.",
        ),
        ("item-description.iron-plate", "CFG SHOULD NOT WIN"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    build_catalog(&raw, &dl, &cfg, &meta()).expect("build_catalog")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn items_sorted_by_group_subgroup_order_name() {
    let (cat, _) = build_fixture();
    let ids: Vec<&str> = cat.items.iter().map(|i| i.id.as_str()).collect();
    // production group (b) first, then intermediate-products (c): raw-material (b)
    // before science-pack (y); within raw-material, order a[iron] < b[copper].
    assert_eq!(
        ids,
        vec![
            "assembling-machine-1",
            "chemical-plant",
            "no-fluid-crafter",
            "iron-plate",
            "copper-plate",
            "automation-science-pack",
        ]
    );
}

#[test]
fn hidden_prototypes_excluded_and_counted() {
    let (cat, counts) = build_fixture();
    assert!(cat.items.iter().all(|i| i.id != "hidden-item"));
    assert!(cat.items.iter().all(|i| i.id != "flag-hidden-item")); // flag form too
    assert!(cat.fluids.iter().all(|f| f.id != "hidden-fluid"));
    assert!(cat.recipes.iter().all(|r| r.id != "hidden-recipe"));
    assert!(cat.technologies.iter().all(|t| t.id != "hidden-tech"));
    assert_eq!(counts.items, 2); // hidden-item + flag-hidden-item
    assert_eq!(counts.fluids, 1);
    assert_eq!(counts.recipes, 1);
    assert_eq!(counts.technologies, 1);
}

#[test]
fn fluids_sorted_and_grouped() {
    let (cat, _) = build_fixture();
    let ids: Vec<&str> = cat.fluids.iter().map(|f| f.id.as_str()).collect();
    assert_eq!(ids, vec!["water", "petroleum-gas"]);
    let water = cat.fluids.iter().find(|f| f.id == "water").unwrap();
    assert_eq!(water.group, "fluids");
    assert_eq!(water.subgroup, "fluid");
    assert_eq!(water.icon_id, "fluid/water");
}

#[test]
fn machine_subobject_and_energy_parse() {
    let (cat, _) = build_fixture();
    let am = find_item(&cat, "assembling-machine-1");
    let m = am.machine.as_ref().expect("machine sub-object");
    assert_eq!(m.speed, serde_json::json!(0.5));
    assert_eq!(m.module_slots, 2);
    assert_eq!(m.energy_usage_kw, serde_json::json!(75)); // "75kW" → 75
    assert_eq!(m.crafting_categories, vec!["crafting"]);
    // Non-machine item has no sub-object.
    assert!(find_item(&cat, "iron-plate").machine.is_none());
    // module_slots default 0 when absent.
    assert_eq!(
        find_item(&cat, "no-fluid-crafter")
            .machine
            .as_ref()
            .unwrap()
            .module_slots,
        0
    );
}

#[test]
fn producers_category_match_and_fluidbox_exclusion() {
    let (cat, _) = build_fixture();
    // crafting recipe → only the crafting machine.
    assert_eq!(
        find_recipe(&cat, "iron-gear-wheel").producers,
        vec!["assembling-machine-1"]
    );
    // chemistry recipe needing a fluid input → the fluid-capable machine only;
    // no-fluid-crafter matches the category but can't take the fluid.
    assert_eq!(
        find_recipe(&cat, "plastic-bar").producers,
        vec!["chemical-plant"]
    );
}

#[test]
fn recipe_defaults_applied() {
    let (cat, _) = build_fixture();
    let gear = find_recipe(&cat, "iron-gear-wheel");
    assert_eq!(gear.category, "crafting"); // default
    assert_eq!(gear.time, serde_json::json!(0.5)); // energy_required default
                                                   // ingredient / result amount default 1.
    let d = find_recipe(&cat, "default-amounts");
    assert_eq!(d.ingredients[0].amount, serde_json::json!(1));
    assert_eq!(d.results[0].amount, serde_json::json!(1));
}

#[test]
fn result_amount_range_midpoint_and_probability() {
    let (cat, _) = build_fixture();
    // amount_min 1 / amount_max 3 → midpoint 2.
    assert_eq!(
        find_recipe(&cat, "range-recipe").results[0].amount,
        serde_json::json!(2)
    );
    // probability kept when < 1, omitted when == 1.
    let u = find_recipe(&cat, "uranium-processing");
    assert_eq!(u.results[0].probability, Some(serde_json::json!(0.007)));
    assert_eq!(find_recipe(&cat, "prob-one").results[0].probability, None);
    // integer amounts serialize as integers.
    assert_eq!(
        find_recipe(&cat, "iron-gear-wheel").ingredients[0].amount,
        serde_json::json!(2)
    );
}

#[test]
fn recipe_icon_only_when_own_icon() {
    let (cat, _) = build_fixture();
    // iron-gear-wheel has no own icon → iconId omitted (consumer falls back).
    assert_eq!(find_recipe(&cat, "iron-gear-wheel").icon_id, None);
    // custom-icon-recipe defines `icon` → iconId present.
    assert_eq!(
        find_recipe(&cat, "custom-icon-recipe").icon_id.as_deref(),
        Some("recipe/custom-icon-recipe")
    );
}

#[test]
fn technology_normal() {
    let (cat, _) = build_fixture();
    let a = find_tech(&cat, "automation");
    assert_eq!(a.label, "Automation");
    // Only unlock-recipe effects, in order; the numeric modifier is dropped.
    assert_eq!(a.unlocks, vec!["assembling-machine-1", "long-inserter"]);
    let unit = a.unit.as_ref().expect("unit for count tech");
    assert_eq!(unit.count, Some(serde_json::json!(10)));
    assert_eq!(unit.time, serde_json::json!(15));
    assert_eq!(unit.ingredients[0].id, "automation-science-pack");
    assert_eq!(unit.ingredients[0].amount, serde_json::json!(1));
    assert_eq!(a.research_trigger, None);
    assert_eq!(a.count_formula, None);
}

#[test]
fn technology_trigger_has_no_unit() {
    let (cat, _) = build_fixture();
    let t = find_tech(&cat, "steel-processing");
    assert_eq!(t.research_trigger.as_deref(), Some("craft-item"));
    assert!(t.unit.is_none());
    assert_eq!(t.unlocks, vec!["steel-plate"]);
}

#[test]
fn technology_infinite_count_formula() {
    let (cat, _) = build_fixture();
    let t = find_tech(&cat, "mining-productivity-infinite");
    assert_eq!(t.count_formula.as_deref(), Some("2^(L-6)*1000"));
    assert_eq!(t.max_level.as_deref(), Some("infinite"));
    // count_formula techs still carry a unit (time + ingredients), just no count.
    let unit = t.unit.as_ref().expect("unit");
    assert_eq!(unit.count, None);
    assert_eq!(unit.time, serde_json::json!(60));
}

#[test]
fn technologies_sorted_by_order() {
    let (cat, _) = build_fixture();
    let ids: Vec<&str> = cat.technologies.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "automation",
            "steel-processing",
            "mining-productivity-infinite"
        ]
    );
}

#[test]
fn locale_precedence_and_rich_text_strip() {
    let (cat, _) = build_fixture();
    // dump description wins over .cfg and is stripped of rich text.
    assert_eq!(
        find_item(&cat, "iron-plate").description.as_deref(),
        Some("Made from iron ore.")
    );
    // .cfg fallback when the dump has no description; rich text stripped.
    assert_eq!(
        find_item(&cat, "copper-plate").description.as_deref(),
        Some("A copper plate.")
    );
    // No description anywhere → key omitted.
    assert!(find_item(&cat, "assembling-machine-1")
        .description
        .is_none());
    // Missing name → falls back to the id.
    assert_eq!(
        find_item(&cat, "no-fluid-crafter").label,
        "no-fluid-crafter"
    );
    // Fluid name resolves; the WRONG item-category entry for "water" is ignored.
    assert_eq!(
        cat.fluids.iter().find(|f| f.id == "water").unwrap().label,
        "Water"
    );
}

#[test]
fn pack_metadata_mirrored() {
    let (cat, _) = build_fixture();
    assert_eq!(cat.schema_version, 1);
    assert_eq!(cat.generated, "2026-07-24T12:00:00Z");
    assert_eq!(cat.pack.id, "test-pack");
    assert_eq!(cat.pack.label, "Test Pack");
    assert_eq!(cat.pack.factorio_version, "2.0");
    assert_eq!(cat.pack.mods[0].name, "base");
    assert_eq!(cat.pack.mods[0].version, "2.0.76");
}

// -- unit helpers ----------------------------------------------------------

#[test]
fn parse_energy_units() {
    assert_eq!(parse_energy_kw("150kW").unwrap(), 150.0);
    assert_eq!(parse_energy_kw("2.5MW").unwrap(), 2500.0);
    assert_eq!(parse_energy_kw("60W").unwrap(), 0.06);
    assert_eq!(parse_energy_kw("1GW").unwrap(), 1_000_000.0);
    assert!(parse_energy_kw("nonsense").is_err());
    assert!(parse_energy_kw("12kJ").is_err()); // wrong unit → loud failure
}

#[test]
fn sanitize_strips_tags_and_collapses_whitespace() {
    assert_eq!(
        sanitize_description("[color=red]Hot[/color] stuff"),
        "Hot stuff"
    );
    assert_eq!(
        sanitize_description("Use [item=iron-plate]  now"),
        "Use now"
    );
    assert_eq!(sanitize_description("[img=utility/x]"), "");
    assert_eq!(sanitize_description("a\n\nb"), "a b");
    // A non-tag bracket phrase survives (conservative matcher).
    assert_eq!(sanitize_description("see [1] below"), "see [1] below");
}

#[test]
fn number_formats_whole_vs_fraction() {
    assert_eq!(number(2.0), serde_json::json!(2));
    assert_eq!(number(0.5), serde_json::json!(0.5));
    assert_eq!(number(100.0), serde_json::json!(100));
}

#[test]
fn icon_exclusion_cascades_to_references() {
    let (mut cat, _) = build_fixture();
    let missing: HashSet<String> = [
        "item/iron-plate",
        "item/chemical-plant",
        "technology/automation",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let cascade = exclude_missing_icons(&mut cat, &missing);

    // The icon-less entries themselves are gone.
    assert!(cat
        .items
        .iter()
        .all(|i| i.id != "iron-plate" && i.id != "chemical-plant"));
    assert!(cat.technologies.iter().all(|t| t.id != "automation"));

    // Every recipe touching iron-plate as an ingredient is dropped outright —
    // no dangling ids for consumers to chase.
    for id in [
        "iron-gear-wheel",
        "prob-one",
        "range-recipe",
        "default-amounts",
        "custom-icon-recipe",
    ] {
        assert!(
            cat.recipes.iter().all(|r| r.id != id),
            "recipe {id} should have been dropped by the cascade"
        );
    }
    assert_eq!(cascade.recipes_dropped, 5);

    // plastic-bar references nothing removed, so it survives — but its sole
    // producer (the excluded chemical-plant) is pruned out.
    let plastic = cat
        .recipes
        .iter()
        .find(|r| r.id == "plastic-bar")
        .expect("plastic-bar survives");
    assert!(plastic.producers.is_empty());
    assert_eq!(cascade.producer_refs_pruned, 1);

    // steel-processing loses its prerequisite on the removed automation tech;
    // its unlock survives (steel-plate was never a catalog recipe to drop).
    let steel = cat
        .technologies
        .iter()
        .find(|t| t.id == "steel-processing")
        .expect("steel-processing survives");
    assert!(steel.prerequisites.is_empty());
    assert_eq!(cascade.prerequisite_refs_pruned, 1);
    assert_eq!(cascade.unlock_refs_pruned, 0);
}
