//! The browser artifact's `catalog.json` — a curated, display-ordered projection
//! of `--dump-data`'s `data-raw-dump.json` (plus engine-resolved locale). This
//! module owns both the *input* serde structs (a typed **partial** view of
//! `data.raw`: unknown fields are ignored, never `deny_unknown_fields`, because
//! the dump is hundreds of MB and carries dozens of fields we don't need) and
//! the *output* structs (the FIB-facing contract, `docs`/catalog-contract.md).
//!
//! Field-shape provenance: items / fluids / recipes / crafting-machine entities
//! were cross-checked against the committed `data/output/*/data.json` (real
//! 2.0.76 `data.raw` serializations). Technologies, item-groups and
//! item-subgroups are **not** present in those files, so their shapes rest on
//! `docs`/dump-spec.md alone and are marked `[UNVERIFIED vs real dump]` — a real
//! run is the first check.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// Input: a partial, typed view of data-raw-dump.json
// ---------------------------------------------------------------------------

/// Deserialize a dump array field tolerantly: Factorio's JSON writer serializes
/// an EMPTY Lua table as `{}` (Lua cannot tell an empty array from an empty
/// map — seen in a real 2.0.76 dump on `recipe-unknown`'s `"ingredients": {}`),
/// so accept a sequence or an empty map. A NON-empty map here is a genuine
/// shape surprise and aborts loudly rather than being silently dropped. Every
/// `Vec` field of the input structs goes through this.
fn lua_seq<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    struct SeqOrEmptyMap<T>(std::marker::PhantomData<T>);
    impl<'de, T: serde::Deserialize<'de>> serde::de::Visitor<'de> for SeqOrEmptyMap<T> {
        type Value = Vec<T>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a sequence, or the `{}` Lua serializes an empty array as")
        }
        fn visit_seq<A: serde::de::SeqAccess<'de>>(self, seq: A) -> Result<Self::Value, A::Error> {
            serde::Deserialize::deserialize(serde::de::value::SeqAccessDeserializer::new(seq))
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut map: A,
        ) -> Result<Self::Value, A::Error> {
            match map.next_key::<serde::de::IgnoredAny>()? {
                None => Ok(Vec::new()),
                Some(_) => Err(serde::de::Error::custom(
                    "non-empty map where a sequence was expected",
                )),
            }
        }
    }
    deserializer.deserialize_any(SeqOrEmptyMap(std::marker::PhantomData))
}

/// Top level of `data-raw-dump.json`: `{ "<category>": { "<name>": {…}, … } }`.
/// Each category we care about is an object keyed by prototype name. Categories
/// we don't project (entities other than crafting machines, tiles, sounds, …)
/// are simply absent from this struct and skipped by serde.
#[derive(Deserialize, Default)]
pub struct DataRaw {
    // Item-like categories. In-game they all localise under the shared
    // `item-name.*` / `item-description.*` keys and dump their icons to the
    // `item/` folder, so we treat them uniformly.
    #[serde(default)]
    pub item: HashMap<String, ItemProto>,
    #[serde(default)]
    pub ammo: HashMap<String, ItemProto>,
    #[serde(default)]
    pub armor: HashMap<String, ItemProto>,
    #[serde(default)]
    pub capsule: HashMap<String, ItemProto>,
    #[serde(default)]
    pub gun: HashMap<String, ItemProto>,
    #[serde(default)]
    pub module: HashMap<String, ItemProto>,
    #[serde(default)]
    pub tool: HashMap<String, ItemProto>,
    #[serde(default, rename = "item-with-entity-data")]
    pub item_with_entity_data: HashMap<String, ItemProto>,
    #[serde(default, rename = "rail-planner")]
    pub rail_planner: HashMap<String, ItemProto>,
    #[serde(default, rename = "repair-tool")]
    pub repair_tool: HashMap<String, ItemProto>,
    #[serde(default, rename = "selection-tool")]
    pub selection_tool: HashMap<String, ItemProto>,
    #[serde(default, rename = "spidertron-remote")]
    pub spidertron_remote: HashMap<String, ItemProto>,
    #[serde(default, rename = "space-platform-starter-pack")]
    pub space_platform_starter_pack: HashMap<String, ItemProto>,

    #[serde(default)]
    pub fluid: HashMap<String, FluidProto>,

    // Crafting machines — the three prototype types that share
    // `crafting_categories` + `crafting_speed` (the producer set is derived
    // from these). Boilers/labs/drills craft synthesized recipes we don't model.
    #[serde(default, rename = "assembling-machine")]
    pub assembling_machine: HashMap<String, MachineProto>,
    #[serde(default)]
    pub furnace: HashMap<String, MachineProto>,
    #[serde(default, rename = "rocket-silo")]
    pub rocket_silo: HashMap<String, MachineProto>,

    #[serde(default)]
    pub recipe: HashMap<String, RecipeProto>,
    #[serde(default)]
    pub technology: HashMap<String, TechProto>,

    #[serde(default, rename = "item-group")]
    pub item_group: HashMap<String, GroupProto>,
    #[serde(default, rename = "item-subgroup")]
    pub item_subgroup: HashMap<String, SubgroupProto>,
}

/// An item-like prototype. Cross-checked against `data.json` items (`type`,
/// `name`, `stack_size`, `subgroup`, `order`, `hidden`). `place_result` links an
/// item to the entity it builds — the machine link the producer step needs; it
/// is present in real `data.raw` but stripped from the curated `data.json`, so
/// that one field is `[UNVERIFIED vs real dump — re-check on first run]`.
#[derive(Deserialize, Clone)]
pub struct ItemProto {
    pub name: String,
    #[serde(default)]
    pub stack_size: Option<u64>,
    #[serde(default)]
    pub subgroup: Option<String>,
    #[serde(default)]
    pub order: Option<String>,
    #[serde(default)]
    pub place_result: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, deserialize_with = "lua_seq")]
    pub flags: Vec<String>,
}

impl ItemProto {
    /// 2.0 marks hidden items with a dedicated `hidden` bool; older data (and
    /// some mods) still use the `"hidden"` item flag — honor both.
    fn is_hidden(&self) -> bool {
        self.hidden || self.flags.iter().any(|f| f == "hidden")
    }
}

/// A fluid prototype (`data.json`-verified: `type`, `name`, `subgroup`, `order`).
#[derive(Deserialize, Clone)]
pub struct FluidProto {
    pub name: String,
    #[serde(default)]
    pub subgroup: Option<String>,
    #[serde(default)]
    pub order: Option<String>,
    #[serde(default)]
    pub hidden: bool,
}

/// A crafting-machine entity. `data.json`-verified: `crafting_categories` (array
/// of strings), `crafting_speed` (number), `energy_usage` (unit-suffixed STRING,
/// e.g. `"150kW"`), `module_slots` (number), `fluid_boxes` (array of objects with
/// `production_type`).
#[derive(Deserialize, Clone)]
pub struct MachineProto {
    // (name is the map key — not repeated here)
    #[serde(default, deserialize_with = "lua_seq")]
    pub crafting_categories: Vec<String>,
    #[serde(default)]
    pub crafting_speed: Option<f64>,
    #[serde(default)]
    pub energy_usage: Option<String>,
    #[serde(default)]
    pub module_slots: Option<u64>,
    #[serde(default, deserialize_with = "lua_seq")]
    pub fluid_boxes: Vec<FluidBox>,
}

/// One fluid box of a machine. We only need `production_type` to count how many
/// fluid inputs/outputs the machine can service (`input` / `output` /
/// `input-output`). A trailing non-box marker element (e.g. an
/// `off_when_no_fluid_recipe` flag) deserializes with `production_type: None`
/// and correctly counts as neither.
#[derive(Deserialize, Clone, Default)]
pub struct FluidBox {
    #[serde(default)]
    pub production_type: Option<String>,
}

impl FluidBox {
    fn is_input(&self) -> bool {
        matches!(
            self.production_type.as_deref(),
            Some("input") | Some("input-output")
        )
    }
    fn is_output(&self) -> bool {
        matches!(
            self.production_type.as_deref(),
            Some("output") | Some("input-output")
        )
    }
}

/// A recipe prototype. `data.json`-verified: `category` (SINGULAR string — see
/// the deviation note in the module docs / final report; dump-spec.md's plural
/// `categories` is a 2.1 model artifact), `energy_required`, `enabled`,
/// `ingredients`/`results` (arrays of tagged `{type,name,amount,…}`),
/// `main_product`, `subgroup`, `order`, `icon`/`icons`.
#[derive(Deserialize, Clone)]
pub struct RecipeProto {
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub subgroup: Option<String>,
    #[serde(default)]
    pub order: Option<String>,
    #[serde(default)]
    pub energy_required: Option<f64>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub main_product: Option<String>,
    #[serde(default, deserialize_with = "lua_seq")]
    pub ingredients: Vec<Ingredient>,
    #[serde(default, deserialize_with = "lua_seq")]
    pub results: Vec<Product>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub icons: Option<serde_json::Value>,
}

impl RecipeProto {
    /// A recipe emits its own `recipe/<name>.png` icon (and thus a `recipe/…`
    /// iconId) only when it defines `icon`/`icons`; otherwise the game — and our
    /// consumers — fall back to the recipe's main product icon.
    fn has_own_icon(&self) -> bool {
        self.icon.is_some() || self.icons.is_some()
    }
}

/// A recipe ingredient (2.0 tagged form). `data.json`-verified.
#[derive(Deserialize, Clone)]
pub struct Ingredient {
    #[serde(rename = "type", default = "default_item_type")]
    pub typ: String,
    pub name: String,
    #[serde(default)]
    pub amount: Option<f64>,
}

/// A recipe product (2.0 tagged form). `data.json`-verified, including the
/// `probability` + `amount` pair (e.g. uranium-processing). `amount` is optional
/// when an `amount_min`/`amount_max` range is given instead.
#[derive(Deserialize, Clone)]
pub struct Product {
    #[serde(rename = "type", default = "default_item_type")]
    pub typ: String,
    pub name: String,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub amount_min: Option<f64>,
    #[serde(default)]
    pub amount_max: Option<f64>,
    #[serde(default)]
    pub probability: Option<f64>,
}

fn default_item_type() -> String {
    "item".to_string()
}

/// A technology prototype. `[UNVERIFIED vs real dump]` — absent from `data.json`;
/// shape from dump-spec.md: `prerequisites` (tech names), `effects` (modifiers,
/// we read `unlock-recipe`), `unit`, `research_trigger` (trigger techs, no unit),
/// `max_level` (number or `"infinite"`).
#[derive(Deserialize, Clone)]
pub struct TechProto {
    pub name: String,
    #[serde(default)]
    pub order: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, deserialize_with = "lua_seq")]
    pub prerequisites: Vec<String>,
    #[serde(default, deserialize_with = "lua_seq")]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub unit: Option<TechUnit>,
    #[serde(default)]
    pub research_trigger: Option<ResearchTrigger>,
    #[serde(default)]
    pub max_level: Option<MaxLevel>,
}

/// A technology modifier. We only discriminate `unlock-recipe` (which carries a
/// `recipe` name); every other modifier type is ignored. `[UNVERIFIED vs real
/// dump]`.
#[derive(Deserialize, Clone)]
pub struct Effect {
    #[serde(rename = "type")]
    pub typ: String,
    #[serde(default)]
    pub recipe: Option<String>,
}

/// A technology's research cost. `ingredients` are `[name, amount]` TUPLES in the
/// dump (not `{name, amount}` objects). `count_formula` (a string math
/// expression) appears instead of `count` for infinite/leveled techs.
/// `[UNVERIFIED vs real dump]`.
#[derive(Deserialize, Clone)]
pub struct TechUnit {
    #[serde(default)]
    pub count: Option<f64>,
    #[serde(default)]
    pub count_formula: Option<String>,
    #[serde(default)]
    pub time: Option<f64>,
    #[serde(default, deserialize_with = "lua_seq")]
    pub ingredients: Vec<ResearchIngredient>,
}

/// `[ItemID, amount]` tuple. `[UNVERIFIED vs real dump]`.
#[derive(Deserialize, Clone)]
pub struct ResearchIngredient(pub String, pub f64);

/// A 2.0 trigger-tech's `research_trigger`; we surface only its `type` string.
/// `[UNVERIFIED vs real dump]`.
#[derive(Deserialize, Clone)]
pub struct ResearchTrigger {
    #[serde(rename = "type")]
    pub typ: String,
}

/// `max_level` is either a number or the literal `"infinite"`. `[UNVERIFIED vs
/// real dump]`.
#[derive(Deserialize, Clone)]
#[serde(untagged)]
pub enum MaxLevel {
    Num(u64),
    Word(String),
}

impl MaxLevel {
    fn as_string(&self) -> String {
        match self {
            MaxLevel::Num(n) => n.to_string(),
            MaxLevel::Word(w) => w.clone(),
        }
    }
}

/// An item-group prototype. `[UNVERIFIED vs real dump]` — the curated
/// `data.json` carries the group tree as `inventoryLayout`, not the raw
/// `item-group`/`item-subgroup` categories.
#[derive(Deserialize, Clone)]
pub struct GroupProto {
    // (name is the map key — not repeated here)
    #[serde(default)]
    pub order: Option<String>,
}

/// An item-subgroup prototype: `group` links it up to its item-group. `order` is
/// the within-group sort string. `[UNVERIFIED vs real dump]`.
#[derive(Deserialize, Clone)]
pub struct SubgroupProto {
    // (name is the map key — not repeated here)
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub order: Option<String>,
}

// ---------------------------------------------------------------------------
// Locale (engine-resolved, from --dump-prototype-locale)
// ---------------------------------------------------------------------------

/// One `<category>-locale.json` file: `names` (confirmed key) and `descriptions`
/// (UNVERIFIED — the wiki says the flag dumps descriptions too, but the exact key
/// is unconfirmed until a real run; if absent we fall back to the `.cfg` map).
#[derive(Deserialize, Default)]
pub struct LocaleCategory {
    #[serde(default)]
    pub names: HashMap<String, String>,
    #[serde(default)]
    pub descriptions: HashMap<String, String>,
}

/// All the `<category>-locale.json` files, keyed by category (`item`, `fluid`,
/// `recipe`, `technology`, …).
#[derive(Default)]
pub struct DumpLocale {
    pub categories: HashMap<String, LocaleCategory>,
}

impl DumpLocale {
    fn name(&self, category: &str, key: &str) -> Option<&str> {
        self.categories
            .get(category)
            .and_then(|c| c.names.get(key))
            .map(String::as_str)
    }
    fn description(&self, category: &str, key: &str) -> Option<&str> {
        self.categories
            .get(category)
            .and_then(|c| c.descriptions.get(key))
            .map(String::as_str)
    }
}

// ---------------------------------------------------------------------------
// Output: the catalog.json contract
// ---------------------------------------------------------------------------

/// Everything about the pack we mirror into `catalog.pack` — supplied by the
/// orchestrator (id/label/version from the manifest, mods from each enabled
/// mod's `info.json`).
pub struct PackMeta {
    pub id: String,
    pub label: String,
    pub factorio_version: String,
    pub generated: String,
    pub mods: Vec<ModRef>,
}

#[derive(Serialize, Clone)]
pub struct ModRef {
    pub name: String,
    pub version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub schema_version: u32,
    pub generated: String,
    pub pack: PackInfo,
    pub items: Vec<Item>,
    pub fluids: Vec<Fluid>,
    pub recipes: Vec<Recipe>,
    pub technologies: Vec<Technology>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: String,
    pub label: String,
    pub factorio_version: String,
    pub mods: Vec<ModRef>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub stack_size: u64,
    pub group: String,
    pub subgroup: String,
    pub icon_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine: Option<Machine>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub speed: serde_json::Value,
    pub module_slots: u64,
    pub energy_usage_kw: serde_json::Value,
    pub crafting_categories: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fluid {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub group: String,
    pub subgroup: String,
    pub icon_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub time: serde_json::Value,
    pub category: String,
    pub ingredients: Vec<IngredientOut>,
    pub results: Vec<ProductOut>,
    pub producers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_id: Option<String>,
}

#[derive(Serialize)]
pub struct IngredientOut {
    #[serde(rename = "type")]
    pub typ: String,
    pub id: String,
    pub amount: serde_json::Value,
}

#[derive(Serialize)]
pub struct ProductOut {
    #[serde(rename = "type")]
    pub typ: String,
    pub id: String,
    pub amount: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probability: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Technology {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub prerequisites: Vec<String>,
    pub unlocks: Vec<String>,
    pub icon_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<TechUnitOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub research_trigger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count_formula: Option<String>,
    // Additive beyond catalog-contract.md v1 (contract omits max_level); cheap to
    // include from the prototype, and additions are schemaVersion-compatible.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_level: Option<String>,
}

#[derive(Serialize)]
pub struct TechUnitOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<serde_json::Value>,
    pub time: serde_json::Value,
    pub ingredients: Vec<ResearchIngredientOut>,
}

#[derive(Serialize)]
pub struct ResearchIngredientOut {
    pub id: String,
    pub amount: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

/// Emit a whole value as an integer (`2`) and a fractional one as a float
/// (`0.5`), so the catalog's numbers read like the game's (`"amount": 2`, not
/// `2.0`) while staying plain JSON numbers per the contract. The `2^53` guard is
/// the exact-integer range of an `f64`, beyond which the `as i64` cast would be
/// lossy — such amounts never occur but the guard keeps the function total.
pub fn number(x: f64) -> serde_json::Value {
    if x.is_finite() && x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 {
        serde_json::Value::from(x as i64)
    } else {
        serde_json::Value::from(x)
    }
}

/// Parse a Factorio energy string (`"150kW"`, `"2.5MW"`, `"60W"`) into kilowatts.
/// Fails loudly (naming the offending value) rather than guessing — a real run
/// must surface any unit we didn't anticipate.
pub fn parse_energy_kw(raw: &str) -> Result<f64, String> {
    let s = raw.trim();
    let body = s
        .strip_suffix('W')
        .or_else(|| s.strip_suffix('w'))
        .ok_or_else(|| format!("energy_usage {raw:?} does not end in a 'W' unit"))?;
    // The optional SI prefix is the last char when it's a known multiplier.
    let (num_str, factor_w) = match body.chars().last() {
        Some('k') | Some('K') => (&body[..body.len() - 1], 1e3),
        Some('M') => (&body[..body.len() - 1], 1e6),
        Some('G') => (&body[..body.len() - 1], 1e9),
        Some('T') => (&body[..body.len() - 1], 1e12),
        _ => (body, 1.0),
    };
    let value: f64 = num_str
        .trim()
        .parse()
        .map_err(|_| format!("energy_usage {raw:?} has an unparseable number {num_str:?}"))?;
    Ok(value * factor_w / 1000.0)
}

// ---------------------------------------------------------------------------
// Locale resolution + rich-text sanitization
// ---------------------------------------------------------------------------

lazy_static! {
    /// Conservative Factorio rich-text tag matcher: an opening or closing tag
    /// whose name starts with a letter, with an optional `=value` payload —
    /// `[color=red]`, `[/color]`, `[item=iron-plate]`, `[img=utility/…]`,
    /// `[font=default-bold]`, `[entity=…]`, `[virtual-signal=…]`, `[gps=…,…]`.
    /// Deliberately narrower than FactorioLab's `\[.*?\]` so a literal bracketed
    /// phrase that isn't a tag survives.
    static ref RICH_TEXT: regex::Regex =
        regex::Regex::new(r"\[/?[A-Za-z][A-Za-z0-9_-]*(=[^\]]*)?\]").unwrap();
    /// Any run of whitespace (incl. the newlines a stripped tag can leave behind).
    static ref WHITESPACE: regex::Regex = regex::Regex::new(r"\s+").unwrap();
}

/// Strip rich-text tags and collapse the resulting doubled whitespace. Returns
/// an empty string only when the input was empty or entirely tags/whitespace.
pub fn sanitize_description(s: &str) -> String {
    let stripped = RICH_TEXT.replace_all(s, "");
    WHITESPACE.replace_all(&stripped, " ").trim().to_string()
}

/// Resolve a display name: engine-dumped `names` first, then the `.cfg` fallback
/// map, then the raw prototype name (so a missing translation degrades to the id
/// rather than throwing).
fn resolve_name(
    locale: &DumpLocale,
    cfg: &HashMap<String, String>,
    category: &str,
    name: &str,
) -> String {
    if let Some(n) = locale.name(category, name) {
        return n.to_string();
    }
    if let Some(n) = cfg.get(&format!("{category}-name.{name}")) {
        return n.clone();
    }
    name.to_string()
}

/// Resolve a description: engine-dumped `descriptions` first, then the `.cfg`
/// fallback map (`<category>-description.<name>`), sanitized. `None` when the game
/// has none — the contract omits the `description` key in that case.
fn resolve_description(
    locale: &DumpLocale,
    cfg: &HashMap<String, String>,
    category: &str,
    name: &str,
) -> Option<String> {
    let raw = locale
        .description(category, name)
        .map(str::to_string)
        .or_else(|| cfg.get(&format!("{category}-description.{name}")).cloned())?;
    let clean = sanitize_description(&raw);
    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/// Display-order sort key: `(group order, subgroup order, prototype order,
/// name)`. Strings are compared byte-lexicographically — deterministic, and for
/// the ASCII `a[x]-b[y]` order strings the game uses it matches the in-game sort
/// in every case we've seen. (FactorioLab uses JS `localeCompare`; the two can
/// differ on non-ASCII order strings — noted as a deviation.)
type SortKey = (String, String, String, String);

/// Default item subgroup when a prototype omits `subgroup` (the game's default).
const DEFAULT_ITEM_SUBGROUP: &str = "other";
/// Default fluid subgroup when a prototype omits `subgroup`.
const DEFAULT_FLUID_SUBGROUP: &str = "fluid";

struct Groups<'a> {
    groups: &'a HashMap<String, GroupProto>,
    subgroups: &'a HashMap<String, SubgroupProto>,
}

impl Groups<'_> {
    /// The item-group a subgroup belongs to (its `group`), or `"other"` when the
    /// subgroup is unknown — a defensive fallback; unknown subgroups shouldn't
    /// occur in a self-consistent dump.
    fn group_of(&self, subgroup: &str) -> String {
        self.subgroups
            .get(subgroup)
            .and_then(|s| s.group.clone())
            .unwrap_or_else(|| "other".to_string())
    }
    fn group_order(&self, group: &str) -> String {
        self.groups
            .get(group)
            .and_then(|g| g.order.clone())
            .unwrap_or_default()
    }
    fn subgroup_order(&self, subgroup: &str) -> String {
        self.subgroups
            .get(subgroup)
            .and_then(|s| s.order.clone())
            .unwrap_or_default()
    }
    fn sort_key(&self, group: &str, subgroup: &str, order: &str, name: &str) -> SortKey {
        (
            self.group_order(group),
            self.subgroup_order(subgroup),
            order.to_string(),
            name.to_string(),
        )
    }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/// A crafting-machine item, pre-resolved for the producer computation: which
/// item id places it, which recipe categories it crafts, and its fluid I/O
/// capacity. `display_index` is the machine item's position in the sorted item
/// array, so producer lists come out in display order too.
struct MachineItem {
    item_id: String,
    crafting_categories: HashSet<String>,
    fluid_inputs: usize,
    fluid_outputs: usize,
    display_index: usize,
}

/// Build the catalog from a parsed dump + locale sources. Returns the catalog
/// plus the per-category counts of hidden prototypes excluded (for the export
/// log). Icon presence/fallback is applied later by the icon step, which is the
/// authority on which `iconId`s actually resolved to a PNG.
pub fn build_catalog(
    raw: &DataRaw,
    locale: &DumpLocale,
    cfg: &HashMap<String, String>,
    meta: &PackMeta,
) -> Result<(Catalog, ExclusionCounts), String> {
    let groups = Groups {
        groups: &raw.item_group,
        subgroups: &raw.item_subgroup,
    };
    let mut counts = ExclusionCounts::default();

    // -- Crafting machine entities, by name (for the item→machine link) --------
    let mut machine_entities: HashMap<&str, &MachineProto> = HashMap::new();
    for map in [&raw.assembling_machine, &raw.furnace, &raw.rocket_silo] {
        for (name, m) in map {
            machine_entities.insert(name.as_str(), m);
        }
    }

    // -- Items -----------------------------------------------------------------
    // Gather every item-like prototype, skip hidden, resolve group/subgroup and
    // the optional machine sub-object, then sort into display order.
    let mut item_rows: Vec<(SortKey, Item, Option<MachineFacts>)> = Vec::new();
    // A stable, deterministic pass over the item categories.
    let item_maps: [&HashMap<String, ItemProto>; 13] = [
        &raw.item,
        &raw.ammo,
        &raw.armor,
        &raw.capsule,
        &raw.gun,
        &raw.module,
        &raw.tool,
        &raw.item_with_entity_data,
        &raw.rail_planner,
        &raw.repair_tool,
        &raw.selection_tool,
        &raw.spidertron_remote,
        &raw.space_platform_starter_pack,
    ];
    // De-dup by name across categories (a name is unique across item types in a
    // valid dump; the guard just makes the pass total).
    let mut seen_items: HashSet<&str> = HashSet::new();
    for map in item_maps {
        for proto in map.values() {
            if !seen_items.insert(proto.name.as_str()) {
                continue;
            }
            if proto.is_hidden() {
                counts.items += 1;
                continue;
            }
            let subgroup = proto
                .subgroup
                .clone()
                .unwrap_or_else(|| DEFAULT_ITEM_SUBGROUP.to_string());
            let group = groups.group_of(&subgroup);
            let order = proto.order.clone().unwrap_or_default();

            // Machine sub-object + producer facts, if this item places a crafting
            // machine. `place_result` is the item→entity link (UNVERIFIED field).
            let (machine, facts) = match proto
                .place_result
                .as_deref()
                .and_then(|e| machine_entities.get(e))
            {
                Some(m) => {
                    let energy_kw = match &m.energy_usage {
                        Some(e) => parse_energy_kw(e)?,
                        // energy_usage is mandatory on crafting machines; default
                        // to 0 kW if a dump ever omits it rather than aborting.
                        None => 0.0,
                    };
                    let machine = Machine {
                        // crafting_speed is mandatory; default 1.0 if absent.
                        speed: number(m.crafting_speed.unwrap_or(1.0)),
                        module_slots: m.module_slots.unwrap_or(0), // default 0 slots
                        energy_usage_kw: number(energy_kw),
                        crafting_categories: m.crafting_categories.clone(),
                    };
                    let facts = MachineFacts {
                        crafting_categories: m
                            .crafting_categories
                            .iter()
                            .cloned()
                            .collect::<HashSet<_>>(),
                        fluid_inputs: m.fluid_boxes.iter().filter(|b| b.is_input()).count(),
                        fluid_outputs: m.fluid_boxes.iter().filter(|b| b.is_output()).count(),
                    };
                    (Some(machine), Some(facts))
                }
                None => (None, None),
            };

            let item = Item {
                id: proto.name.clone(),
                label: resolve_name(locale, cfg, "item", &proto.name),
                description: resolve_description(locale, cfg, "item", &proto.name),
                stack_size: proto.stack_size.unwrap_or(1), // stack_size mandatory; default 1
                group: group.clone(),
                subgroup: subgroup.clone(),
                icon_id: format!("item/{}", proto.name),
                machine,
            };
            let key = groups.sort_key(&group, &subgroup, &order, &proto.name);
            item_rows.push((key, item, facts));
        }
    }
    item_rows.sort_by(|a, b| a.0.cmp(&b.0));

    // Machine index (over the now-sorted items) for the producer computation.
    let mut machines: Vec<MachineItem> = Vec::new();
    for (display_index, (_, item, facts)) in item_rows.iter().enumerate() {
        if let Some(f) = facts {
            machines.push(MachineItem {
                item_id: item.id.clone(),
                crafting_categories: f.crafting_categories.clone(),
                fluid_inputs: f.fluid_inputs,
                fluid_outputs: f.fluid_outputs,
                display_index,
            });
        }
    }
    let items: Vec<Item> = item_rows.into_iter().map(|(_, item, _)| item).collect();

    // -- Fluids ----------------------------------------------------------------
    let mut fluid_rows: Vec<(SortKey, Fluid)> = Vec::new();
    for proto in raw.fluid.values() {
        if proto.hidden {
            counts.fluids += 1;
            continue;
        }
        let subgroup = proto
            .subgroup
            .clone()
            .unwrap_or_else(|| DEFAULT_FLUID_SUBGROUP.to_string());
        let group = groups.group_of(&subgroup);
        let order = proto.order.clone().unwrap_or_default();
        let fluid = Fluid {
            id: proto.name.clone(),
            label: resolve_name(locale, cfg, "fluid", &proto.name),
            description: resolve_description(locale, cfg, "fluid", &proto.name),
            group: group.clone(),
            subgroup: subgroup.clone(),
            icon_id: format!("fluid/{}", proto.name),
        };
        fluid_rows.push((
            groups.sort_key(&group, &subgroup, &order, &proto.name),
            fluid,
        ));
    }
    fluid_rows.sort_by(|a, b| a.0.cmp(&b.0));
    let fluids: Vec<Fluid> = fluid_rows.into_iter().map(|(_, f)| f).collect();

    // Name→(subgroup, order) index for recipe ordering fallback to main product.
    let mut proto_sort: HashMap<&str, (Option<&str>, Option<&str>)> = HashMap::new();
    for map in item_maps {
        for p in map.values() {
            proto_sort
                .entry(p.name.as_str())
                .or_insert((p.subgroup.as_deref(), p.order.as_deref()));
        }
    }
    for p in raw.fluid.values() {
        proto_sort
            .entry(p.name.as_str())
            .or_insert((p.subgroup.as_deref(), p.order.as_deref()));
    }

    // -- Recipes ---------------------------------------------------------------
    let mut recipe_rows: Vec<(SortKey, Recipe)> = Vec::new();
    for proto in raw.recipe.values() {
        if proto.hidden {
            counts.recipes += 1;
            continue;
        }
        let category = proto
            .category
            .clone()
            .unwrap_or_else(|| "crafting".to_string()); // recipe.category default
        let time = proto.energy_required.unwrap_or(0.5); // energy_required default 0.5
                                                         // `enabled` (default true) is intentionally NOT projected — the catalog
                                                         // lists every non-hidden recipe; whether a recipe starts locked is a
                                                         // tech-tree concern the consumer derives from technology unlocks.

        let ingredients: Vec<IngredientOut> = proto
            .ingredients
            .iter()
            .map(|i| IngredientOut {
                typ: i.typ.clone(),
                id: i.name.clone(),
                amount: number(i.amount.unwrap_or(1.0)), // ingredient amount default 1
            })
            .collect();
        let results: Vec<ProductOut> = proto
            .results
            .iter()
            .map(|r| {
                // amount, or the mid-point of an amount_min/amount_max range (a
                // lone bound stands alone — better the present number than a
                // silent 1), or 1.
                let amount = r
                    .amount
                    .or_else(|| match (r.amount_min, r.amount_max) {
                        (Some(lo), Some(hi)) => Some((lo + hi) / 2.0),
                        (Some(one), None) | (None, Some(one)) => Some(one),
                        (None, None) => None,
                    })
                    .unwrap_or(1.0); // result amount default 1
                ProductOut {
                    typ: r.typ.clone(),
                    id: r.name.clone(),
                    amount: number(amount),
                    // probability default 1 → omitted.
                    probability: match r.probability {
                        Some(p) if p != 1.0 => Some(number(p)),
                        _ => None,
                    },
                }
            })
            .collect();

        // Producers: machine items whose crafting_categories contain this
        // recipe's category, then filtered so the machine's fluid I/O can service
        // the recipe's fluid ingredients/results (FactorioLab's fluidbox filter).
        let fluid_ing = proto
            .ingredients
            .iter()
            .filter(|i| i.typ == "fluid")
            .count();
        let fluid_res = proto.results.iter().filter(|r| r.typ == "fluid").count();
        let mut producer_rows: Vec<(usize, &str)> = machines
            .iter()
            .filter(|m| m.crafting_categories.contains(&category))
            .filter(|m| m.fluid_inputs >= fluid_ing && m.fluid_outputs >= fluid_res)
            .map(|m| (m.display_index, m.item_id.as_str()))
            .collect();
        producer_rows.sort_by_key(|(idx, _)| *idx);
        let producers: Vec<String> = producer_rows
            .into_iter()
            .map(|(_, id)| id.to_string())
            .collect();

        let icon_id = if proto.has_own_icon() {
            Some(format!("recipe/{}", proto.name))
        } else {
            None
        };

        // Effective subgroup/order for display: the recipe's own if set, else the
        // main product's. main_product == Some("") forces the recipe's own; a
        // named main_product or a single result picks that product.
        let main_product: Option<&str> = match proto.main_product.as_deref() {
            Some("") => None,         // force recipe's own
            Some(name) => Some(name), // explicit main product
            None if proto.results.len() == 1 => Some(proto.results[0].name.as_str()),
            None => None,
        };
        let (mp_subgroup, mp_order) = main_product
            .and_then(|n| proto_sort.get(n).copied())
            .unwrap_or((None, None));
        let subgroup = proto
            .subgroup
            .as_deref()
            .or(mp_subgroup)
            .unwrap_or(DEFAULT_ITEM_SUBGROUP)
            .to_string();
        let group = groups.group_of(&subgroup);
        let order = proto
            .order
            .as_deref()
            .or(mp_order)
            .unwrap_or_default()
            .to_string();

        let recipe = Recipe {
            id: proto.name.clone(),
            label: resolve_name(locale, cfg, "recipe", &proto.name),
            description: resolve_description(locale, cfg, "recipe", &proto.name),
            time: number(time),
            category,
            ingredients,
            results,
            producers,
            icon_id,
        };
        recipe_rows.push((
            groups.sort_key(&group, &subgroup, &order, &proto.name),
            recipe,
        ));
    }
    recipe_rows.sort_by(|a, b| a.0.cmp(&b.0));
    let recipes: Vec<Recipe> = recipe_rows.into_iter().map(|(_, r)| r).collect();

    // -- Technologies ----------------------------------------------------------
    // No item-group for techs; sort by (order, name).
    let mut tech_rows: Vec<((String, String), Technology)> = Vec::new();
    for proto in raw.technology.values() {
        if proto.hidden {
            counts.technologies += 1;
            continue;
        }
        let unlocks: Vec<String> = proto
            .effects
            .iter()
            .filter(|e| e.typ == "unlock-recipe")
            .filter_map(|e| e.recipe.clone())
            .collect();

        let research_trigger = proto.research_trigger.as_ref().map(|t| t.typ.clone());
        // count_formula lives on the unit; surfaced at tech top-level per the
        // contract (alongside/instead of unit.count for infinite techs).
        let count_formula = proto.unit.as_ref().and_then(|u| u.count_formula.clone());

        // Trigger techs have no research unit; guard against a dump that carries
        // both by preferring the trigger (dump-spec: trigger techs have no unit).
        let unit = if research_trigger.is_some() {
            None
        } else {
            proto.unit.as_ref().map(|u| TechUnitOut {
                count: u.count.map(number),
                time: number(u.time.unwrap_or(0.0)), // unit.time mandatory; default 0
                ingredients: u
                    .ingredients
                    .iter()
                    .map(|ing| ResearchIngredientOut {
                        id: ing.0.clone(),
                        amount: number(ing.1),
                    })
                    .collect(),
            })
        };

        let tech = Technology {
            id: proto.name.clone(),
            label: resolve_name(locale, cfg, "technology", &proto.name),
            description: resolve_description(locale, cfg, "technology", &proto.name),
            prerequisites: proto.prerequisites.clone(),
            unlocks,
            icon_id: format!("technology/{}", proto.name),
            unit,
            research_trigger,
            count_formula,
            max_level: proto.max_level.as_ref().map(MaxLevel::as_string),
        };
        let order = proto.order.clone().unwrap_or_default();
        tech_rows.push(((order, proto.name.clone()), tech));
    }
    tech_rows.sort_by(|a, b| a.0.cmp(&b.0));
    let technologies: Vec<Technology> = tech_rows.into_iter().map(|(_, t)| t).collect();

    let catalog = Catalog {
        schema_version: 1,
        generated: meta.generated.clone(),
        pack: PackInfo {
            id: meta.id.clone(),
            label: meta.label.clone(),
            factorio_version: meta.factorio_version.clone(),
            mods: meta.mods.clone(),
        },
        items,
        fluids,
        recipes,
        technologies,
    };
    Ok((catalog, counts))
}

/// Facts about a machine item needed only during the build (not serialized).
struct MachineFacts {
    crafting_categories: HashSet<String>,
    fluid_inputs: usize,
    fluid_outputs: usize,
}

/// Per-category counts of hidden prototypes dropped from the catalog — logged by
/// the orchestrator.
#[derive(Default)]
pub struct ExclusionCounts {
    pub items: usize,
    pub fluids: usize,
    pub recipes: usize,
    pub technologies: usize,
}

/// Every `iconId` the catalog references, paired with its `(folder, name)` so the
/// icon step can locate the dumped PNG. Order follows the catalog's display
/// order (items, fluids, recipes-with-own-icon, technologies) so icon-sheet
/// layout is deterministic.
pub fn referenced_icon_ids(catalog: &Catalog) -> Vec<String> {
    let mut ids = Vec::new();
    for i in &catalog.items {
        ids.push(i.icon_id.clone());
    }
    for f in &catalog.fluids {
        ids.push(f.icon_id.clone());
    }
    for r in &catalog.recipes {
        if let Some(id) = &r.icon_id {
            ids.push(id.clone());
        }
    }
    for t in &catalog.technologies {
        ids.push(t.icon_id.clone());
    }
    ids
}

/// What the exclusion cascade removed beyond the icon-less entries themselves —
/// counts for the run log, so a real dump with missing icons reports the full
/// blast radius instead of silently leaving (or silently dropping) references.
pub struct ExclusionCascade {
    pub recipes_dropped: usize,
    pub producer_refs_pruned: usize,
    pub unlock_refs_pruned: usize,
    pub prerequisite_refs_pruned: usize,
}

/// Drop catalog entries whose icon PNG was missing from the dump. Recipes are
/// handled separately (their iconId is just cleared — the consumer falls back to
/// the first result's icon), so `missing` here is item/fluid/technology iconIds
/// only.
///
/// Exclusion cascades: an excluded entry must not linger as a dangling id
/// anywhere else in the catalog (the icon-coverage invariant would pass while
/// consumers chase ids that resolve to nothing). Recipes referencing a removed
/// item/fluid as ingredient or result are dropped outright; removed machines
/// leave `producers` lists; dropped recipes leave technology `unlocks`; removed
/// technologies leave `prerequisites`. One level is enough — dropping a recipe
/// creates no further dangling ids (nothing references recipes but unlocks).
pub fn exclude_missing_icons(catalog: &mut Catalog, missing: &HashSet<String>) -> ExclusionCascade {
    let removed_items: HashSet<String> = catalog
        .items
        .iter()
        .filter(|i| missing.contains(&i.icon_id))
        .map(|i| i.id.clone())
        .collect();
    let removed_fluids: HashSet<String> = catalog
        .fluids
        .iter()
        .filter(|f| missing.contains(&f.icon_id))
        .map(|f| f.id.clone())
        .collect();
    let removed_techs: HashSet<String> = catalog
        .technologies
        .iter()
        .filter(|t| missing.contains(&t.icon_id))
        .map(|t| t.id.clone())
        .collect();
    catalog.items.retain(|i| !missing.contains(&i.icon_id));
    catalog.fluids.retain(|f| !missing.contains(&f.icon_id));
    catalog
        .technologies
        .retain(|t| !missing.contains(&t.icon_id));

    let mut cascade = ExclusionCascade {
        recipes_dropped: 0,
        producer_refs_pruned: 0,
        unlock_refs_pruned: 0,
        prerequisite_refs_pruned: 0,
    };
    let removed_ref = |typ: &str, id: &String| match typ {
        "fluid" => removed_fluids.contains(id),
        _ => removed_items.contains(id),
    };
    let mut dropped_recipes: HashSet<String> = HashSet::new();
    catalog.recipes.retain(|r| {
        let dangling = r.ingredients.iter().any(|i| removed_ref(&i.typ, &i.id))
            || r.results.iter().any(|p| removed_ref(&p.typ, &p.id));
        if dangling {
            dropped_recipes.insert(r.id.clone());
        }
        !dangling
    });
    cascade.recipes_dropped = dropped_recipes.len();
    for r in &mut catalog.recipes {
        let before = r.producers.len();
        r.producers.retain(|p| !removed_items.contains(p));
        cascade.producer_refs_pruned += before - r.producers.len();
    }
    for t in &mut catalog.technologies {
        let before = t.unlocks.len();
        t.unlocks.retain(|u| !dropped_recipes.contains(u));
        cascade.unlock_refs_pruned += before - t.unlocks.len();

        let before = t.prerequisites.len();
        t.prerequisites.retain(|p| !removed_techs.contains(p));
        cascade.prerequisite_refs_pruned += before - t.prerequisites.len();
    }
    cascade
}

/// Clear the iconId of any recipe whose own-icon PNG was missing, so the consumer
/// falls back to the first result's icon rather than following a dead reference.
pub fn clear_missing_recipe_icons(catalog: &mut Catalog, missing: &HashSet<String>) {
    for r in &mut catalog.recipes {
        if let Some(id) = &r.icon_id {
            if missing.contains(id) {
                r.icon_id = None;
            }
        }
    }
}

#[cfg(test)]
mod tests;
