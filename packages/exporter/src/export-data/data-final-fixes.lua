-- start util functions
local function table_merge(t1, t2)
    for k, v in pairs(t2) do
        t1[k] = v
    end
end

local function list_iter(t)
    local i = 0
    local n = #t
    return function()
        i = i + 1
        if i <= n then
            return t[i]
        end
    end
end

local function list_includes(t, v)
    for value in list_iter(t) do
        if value == v then
            return true
        end
    end
    return false
end

local function table_filter(t, blacklist)
    for key in pairs(t) do
        if list_includes(blacklist, key) then
            t[key] = nil
        end
    end
end

local function char_generator()
    local nextIndex = 0
    return function()
        local char = string.char(string.byte('a') + nextIndex)
        nextIndex = nextIndex + 1
        return char
    end
end

local function deep_copy(obj, seen)
    -- Handle non-tables and previously-seen tables.
    if type(obj) ~= 'table' then return obj end
    if seen and seen[obj] then return seen[obj] end

    -- New table; mark it as seen and copy recursively.
    local s = seen or {}
    local res = {}
    s[obj] = res
    for k, v in pairs(obj) do res[deep_copy(k, s)] = deep_copy(v, s) end
    return setmetatable(res, getmetatable(obj))
end

-- end util functions

local locale = require('locale')

-- Resolve a Factorio LocalisedString (https://lua-api.factorio.com/latest/concepts/LocalisedString.html):
-- a plain string/number is literal text; a table is {key, param1, param2, ...}
-- where each param is itself a LocalisedString substituted into the template's
-- __1__, __2__, ... placeholders. Key '' concatenates its params; key '?'
-- takes the first param that resolves. Unknown keys resolve to nil so callers
-- can fall back (the game has fallback chains we don't replicate).
local function resolveLocalised(ls)
    if type(ls) ~= 'table' then
        if ls == nil then return nil end
        return tostring(ls)
    end
    local key = ls[1]
    if key == '' then
        local parts = {}
        for i = 2, #ls do
            parts[#parts + 1] = resolveLocalised(ls[i]) or ''
        end
        return table.concat(parts)
    end
    if key == '?' then
        for i = 2, #ls do
            local alt = resolveLocalised(ls[i])
            if alt ~= nil then return alt end
        end
        return nil
    end
    local template = locale[key]
    if template == nil then
        log('export-data: no locale entry for key ' .. tostring(key))
        return nil
    end
    for i = 2, #ls do
        local param = resolveLocalised(ls[i]) or ''
        -- '%' is magic in a gsub replacement; locale text must stay literal.
        template = template:gsub('__' .. (i - 1) .. '__', (param:gsub('%%', '%%%%')))
    end
    return template
end

local function localise(obj, typeArg)
    obj.localised_name = resolveLocalised(obj.localised_name)
    if obj.localised_name == nil then
        local str = locale[typeArg .. '-name.' .. obj.name]
        if str ~= nil then
            obj.localised_name = str
        else
            obj.localised_name = obj.name:gsub('^%l', string.upper):gsub('-', ' ')
        end
    end

    obj.localised_description = resolveLocalised(obj.localised_description)
    if obj.localised_description == nil then
        obj.localised_description = locale[typeArg .. '-description.' .. obj.name]
    end

    if obj.limitation_message_key ~= nil then
        local str = locale[typeArg .. '-limitation.' .. obj.limitation_message_key]
        if str ~= nil then
            obj.limitation_message = str
        end
        obj.limitation_message_key = nil
    end
end

local creativeEntities = {
    'loader',
    'fast-loader',
    'express-loader',
    'infinity-chest',
    'heat-interface',
    'infinity-pipe',
    'electric-energy-interface'
}

local output = {}

-- ITEMS
do
    local items = {}

    local itemPrototypes = {
        'item',
        'ammo',
        'capsule',
        'gun',
        'item-with-entity-data',
        'item-with-label',
        'item-with-inventory',
        'blueprint-book',
        'item-with-tags',
        'selection-tool',
        'blueprint',
        'copy-paste-tool',
        'deconstruction-item',
        'spidertron-remote',
        'upgrade-item',
        'module',
        'rail-planner',
        'space-platform-starter-pack',
        'tool',
        'armor',
        'repair-tool',
    }

    local getOrder = char_generator()

    for proto in list_iter(itemPrototypes) do
        if data.raw[proto] then
            for _, item in pairs(deep_copy(data.raw[proto])) do
                if list_includes(creativeEntities, item.name) then
                    item.subgroup = 'creative'
                    item.order = getOrder()
                end

                localise(item, 'item')
                items[item.name] = item
            end
        end
    end

    output.items = items
end

-- FLUIDS
do
    local fluids = {}

    for _, fluid in pairs(deep_copy(data.raw.fluid)) do
        localise(fluid, 'fluid')
        fluids[fluid.name] = fluid
    end

    output.fluids = fluids
end

-- SIGNALS
do
    local signals = {}

    for _, signal in pairs(deep_copy(data.raw['virtual-signal'])) do
        localise(signal, 'virtual-signal')
        signals[signal.name] = signal
    end

    output.signals = signals
end

-- RECIPES
do
    local recipes = {}

    for _, recipe in pairs(deep_copy(data.raw.recipe)) do
        if not list_includes(creativeEntities, recipe.name) then
            localise(recipe, 'recipe')
            recipes[recipe.name] = recipe
        end
    end

    output.recipes = recipes
end

--ENTITIES
do
    local entities = {}

    local placeableEntityPrototypes = {
        'accumulator',
        'agricultural-tower',
        'artillery-turret',
        'asteroid-collector',
        -- 'asteroid',
        'beacon',
        'boiler',
        'burner-generator',
        'cargo-bay',
        'cargo-landing-pad',
        -- 'cargo-pod',
        -- 'character',
        'arithmetic-combinator',
        'decider-combinator',
        'selector-combinator',
        'constant-combinator',
        'container',
        'logistic-container',
        'infinity-container',
        'temporary-container',
        'assembling-machine',
        'rocket-silo',
        'furnace',
        'display-panel',
        'electric-energy-interface',
        'electric-pole',
        -- 'unit-spawner',
        -- 'capture-robot',
        -- 'combat-robot',
        -- 'construction-robot',
        -- 'logistic-robot',
        'fusion-generator',
        'fusion-reactor',
        'gate',
        'generator',
        'heat-interface',
        'heat-pipe',
        'inserter',
        'lab',
        'lamp',
        'land-mine',
        'lightning-attractor',
        'linked-container',
        'market',
        'mining-drill',
        'offshore-pump',
        'pipe',
        'infinity-pipe',
        'pipe-to-ground',
        -- 'player-port',
        'power-switch',
        'programmable-speaker',
        'proxy-container',
        'pump',
        'radar',
        'curved-rail-a',
        'elevated-curved-rail-a',
        'curved-rail-b',
        'elevated-curved-rail-b',
        'half-diagonal-rail',
        'elevated-half-diagonal-rail',
        'legacy-curved-rail',
        'legacy-straight-rail',
        'rail-ramp',
        'straight-rail',
        'elevated-straight-rail',
        'rail-chain-signal',
        'rail-signal',
        'rail-support',
        'reactor',
        'roboport',
        -- 'segment',
        -- 'segmented-unit',
        'simple-entity-with-owner',
        'simple-entity-with-force',
        'solar-panel',
        'space-platform-hub',
        -- 'spider-leg',
        -- 'spider-unit',
        'storage-tank',
        'thruster',
        'train-stop',
        'lane-splitter',
        'linked-belt',
        'loader-1x1',
        'loader',
        'splitter',
        'transport-belt',
        'underground-belt',
        'turret',
        'ammo-turret',
        'electric-turret',
        'fluid-turret',
        -- 'unit',
        'valve',
        -- 'car',
        'artillery-wagon',
        'cargo-wagon',
        'infinity-cargo-wagon',
        'fluid-wagon',
        'locomotive',
        -- 'spider-vehicle',
        'wall'
    }

    for proto in list_iter(placeableEntityPrototypes) do
        if data.raw[proto] then
            for _, entity in pairs(deep_copy(data.raw[proto])) do
                if not list_includes(entity.flags or {}, 'not-blueprintable') and
                    not list_includes(entity.flags or {}, 'breaths-air')
                then
                    localise(entity, 'entity')
                    entities[entity.name] = entity
                end
            end
        end
    end

    output.entities = entities
end

-- TILES
do
    local tiles = {}

    for _, tile in pairs(deep_copy(data.raw.tile)) do
        if tile.minable then
            localise(tile, 'tile')
            tiles[tile.name] = tile
        end
    end

    output.tiles = tiles
end

-- INVENTORY LAYOUT
do
    local inventoryLayout = {}

    local groupBlacklist = {
        'environment',
        'enemies',
        'effects',
        'tiles',
        'other'
    }

    local function comp_func(a, b)
        return a.order < b.order
    end

    local subgroups = {
        creative = {
            name = 'creative',
            group = 'creative',
            order = 'z',
            items = {}
        }
    }

    for _, subgroup in pairs(deep_copy(data.raw['item-subgroup'])) do
        subgroups[subgroup.name] = {
            name = subgroup.name,
            group = subgroup.group,
            order = subgroup.order,
            items = {}
        }
    end

    -- A name is placed at most once. Items are added first and win, so a recipe
    -- (or fluid/signal) sharing a product's name — `nuclear-fuel`, `lubricant`,
    -- `sulfuric-acid`, … — no longer lands in the layout a second time and shows
    -- as a duplicate entry in the selector.
    local placed = {}

    local function addEntriesToSubroups(t, defaultSubgroup)
        for _, entry in pairs(t) do
            local subgroup = entry.subgroup or defaultSubgroup
            if subgroup ~= nil and entry.order ~= nil and subgroups[subgroup] ~= nil
                and not placed[entry.name] then
                placed[entry.name] = true
                -- some fluid recipes are missing their icon and order
                -- local fluid = data.raw.fluid[entry.name] or {}
                table.insert(subgroups[subgroup].items, {
                    name = entry.name,
                    icon = entry.icon, -- or fluid.icon,
                    icons = entry.icons,
                    icon_size = entry.icon_size,
                    order = entry.order -- or fluid.order
                })
            end
        end
    end

    -- The product a recipe is "about" — used to inherit its menu placement.
    -- Explicit main_product wins ('' means the recipe designates no single one);
    -- otherwise a lone result is the main product. `result` is a 1.1-era
    -- fallback (2.0 uses `results`).
    local function recipeMainProductName(recipe)
        if recipe.main_product ~= nil then
            if recipe.main_product == '' then return nil end
            return recipe.main_product
        end
        if recipe.results ~= nil and #recipe.results == 1 then
            local r = recipe.results[1]
            return r.name or r[1]
        end
        if recipe.result ~= nil then return recipe.result end
        return nil
    end

    -- Recipes for the layout. A recipe with no explicit subgroup/order inherits
    -- them from its main product, exactly as Factorio does when placing it in the
    -- crafting menu — the raw prototype carries only the *explicit* values, so
    -- without resolving this, product-inheriting recipes (common in overhaul
    -- mods, e.g. SE's `se-iron-ingot-to-plate`: iron ingot -> iron plate in an
    -- assembling machine) get no subgroup and silently drop out of the picker.
    -- `hidden` recipes never appear in a crafting menu (the `recipe-unknown`
    -- placeholder, removed-item recipes, all auto-generated `*-recycling`), so
    -- they're excluded here.
    local function resolvedRecipes()
        local list = {}
        for _, recipe in pairs(deep_copy(data.raw.recipe)) do
            if not recipe.hidden then
                if recipe.subgroup == nil or recipe.order == nil then
                    local productName = recipeMainProductName(recipe)
                    local product = productName ~= nil
                        and (output.items[productName] or output.fluids[productName])
                        or nil
                    if product ~= nil then
                        if recipe.subgroup == nil then recipe.subgroup = product.subgroup end
                        if recipe.order == nil then recipe.order = product.order end
                    end
                end
                table.insert(list, recipe)
            end
        end
        return list
    end

    addEntriesToSubroups(output.items)
    addEntriesToSubroups(resolvedRecipes())
    addEntriesToSubroups(deep_copy(data.raw.fluid), 'fluid')
    addEntriesToSubroups(deep_copy(data.raw['virtual-signal']))

    local infinityChest = output.items['infinity-chest']
    local groups = {
        creative = {
            name = 'creative',
            icon = infinityChest.icon,
            icons = infinityChest.icons,
            icon_size = infinityChest.icon_size,
            order = 'z',
            subgroups = {}
        }
    }

    for _, group in pairs(deep_copy(data.raw['item-group'])) do
        if not list_includes(groupBlacklist, group.name) then
            groups[group.name] = {
                name = group.name,
                icon = group.icon,
                icons = group.icons,
                icon_size = group.icon_size,
                order = group.order,
                subgroups = {}
            }
        end
    end

    for _, subgroup in pairs(subgroups) do
        if groups[subgroup.group] ~= nil and #subgroup.items ~= 0 then
            table.sort(subgroup.items, comp_func)
            table.insert(groups[subgroup.group].subgroups, subgroup)
        end
    end

    for _, group in pairs(groups) do
        localise(group, 'item-group')
        table.sort(group.subgroups, comp_func)
        table.insert(inventoryLayout, group)
    end

    table.sort(inventoryLayout, comp_func)

    output.inventoryLayout = inventoryLayout
end

-- UTILITY SPRITES
do
    output.utilitySprites = data.raw['utility-sprites'].default
end

-- UTILITY CONSTANTS
do
    output.utilityConstants = data.raw['utility-constants'].default
end

-- GUI STYLE
do
    output.guiStyle = data.raw['gui-style'].default
end

-- DEFINES
do
    output.defines = defines
end

-- PASSTROUGH OUTPUT DATA
do
    local serialized = serpent.dump(output)

    -- workaround Factorio's limitation of 200 characters per string
    -- by splitting the serialized data into chunks and embedding it
    -- into dummy entities

    local function embed_data(key, value)
        data:extend({ {
            type = "simple-entity",
            name = key,
            icon = "-",
            icon_size = 1,
            picture = {
                filename = "-",
                width = 1,
                height = 1
            },
            localised_name = value
        } })
    end

    local l = string.len(serialized)
    local total_parts = 0
    for i = 1, l, 200 do
        total_parts = total_parts + 1
        embed_data('FBE-DATA-' .. tostring(total_parts), string.sub(serialized, i, i + 199))
    end

    embed_data('FBE-DATA-COUNT', tostring(total_parts))
end
