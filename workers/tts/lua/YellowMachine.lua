-- Bundled by luabundle {"rootModuleName":"Yellow Machine.46ccee.lua","version":"1.6.0"}
local __bundle_require, __bundle_loaded, __bundle_register, __bundle_modules = (function(superRequire)
	local loadingPlaceholder = {[{}] = true}

	local register
	local modules = {}

	local require
	local loaded = {}

	register = function(name, body)
		if not modules[name] then
			modules[name] = body
		end
	end

	require = function(name)
		local loadedModule = loaded[name]

		if loadedModule then
			if loadedModule == loadingPlaceholder then
				return nil
			end
		else
			if not modules[name] then
				if not superRequire then
					local identifier = type(name) == 'string' and '\"' .. name .. '\"' or tostring(name)
					error('Tried to require ' .. identifier .. ', but no such module has been registered')
				else
					return superRequire(name)
				end
			end

			loaded[name] = loadingPlaceholder
			loadedModule = modules[name](require, loaded, register, modules)
			loaded[name] = loadedModule
		end

		return loadedModule
	end

	return require, loaded, register, modules
end)(nil)
__bundle_register("Yellow Machine.46ccee.lua", function(require, _LOADED, __bundle_register, __bundle_modules)
require("vscode/console")

local DEBUG = false

local loadedData, loadedDataOrder, originalLoadedOrder, edition, uiHeight, uiWidth, useDecorativeNames, armyDisplay, armyText
local url = DEBUG and "http://localhost:3000/get_army_by_id?id=" or "https://yellowscribe.link/get_army_by_id?id="

local uiTemplates = {
    UNIT_CONTAINER = [[ <VerticalLayout color="#475a64" childForceExpandHeight="false" outline="#2a3a44" outlineSize="4">
                            <Text class="unitName">${unitName}</Text>
                            <VerticalLayout class="unitContainer" childForceExpandHeight="false" preferredHeight="${height}" spacing="9">
                                ${unitData}
                            </VerticalLayout>
                        </VerticalLayout> ]],
    MODEL_CONTAINER = [[<VerticalLayout preferredWidth="500" childForceExpandHeight="false" class="modelContainer" id="${unitID}|${modelID}" preferredHeight="${height}">
                            <Text class="modelDataName">${numberString}${modelName}</Text>
                            ${weapons}
                        </VerticalLayout> ]],
    MODEL_DATA = [[ <VerticalLayout childForceExpandHeight="false" childForceExpandWidth="false">
                        <Text height="2"><!-- spacer --></Text>
                        <Text class="modelDataTitle">${dataType}</Text>
                        <Text class="modelData" preferredHeight="${height}">${data}</Text>
                    </VerticalLayout> ]],

    MODEL_GROUPING_CONTAINER = [[ <HorizontalLayout class="groupingContainer">${modelGroups}</HorizontalLayout> ]]
}

--[[ UNIT SCRIPTING DATA ]]--
--[[ everything in this section is meant to be a string because this is what we
are inputting into created models ]]--

local UNIT_SPECIFIC_DATA_TEMPLATE = [[ --[[ UNIT-SPECIFIC DATA ${endBracket}--
local unitData = {
    edition = "${edition}",
    unitName = "${unitName}",
    unitDecorativeName = "${unitDecorativeName}",
    factionKeywords = "${factionKeywords}",
    keywords = "${keywords}",
    abilities = {
        ${abilities}
    },
    models = {
        ${models}
    }${changingCharacteristics}${woundTrack},
    weapons = {
        ${weapons}
    }${psychic},
    uuid = "${uuid}"${singleModel},
    uiHeight = ${height},
    uiWidth = ${width}
} ]]
local CHANGING_CHARACTERISTICS_TEMPLATE = [[,
    changingCharacteristics = {
        ${changingChars}
    },
]]
local WEAPON_TEMPLATE_9E = [[[c6c930]${name}[-]
${rangeAndType} S:${s} AP:${ap} D:${d} ${ability} ]]
local RANGED_WEAPON_TEMPLATE_10E11E = [[[c6c930]${name}[-]
${range} A:${a} BS:${bs} S:${s} AP:${ap} D:${d} [7bc596]${ability}[-] ]]
local MELEE_WEAPON_TEMPLATE_10E11E = [[[c6c930]${name}[-]
A:${a} WS:${ws} S:${s} AP:${ap} D:${d} [7bc596]${ability}[-] ]]
local DEFAULT_BRACKET_VALUE_TEMPLATE = "[98ffa7]${val}[-]"
local ABILITITY_STRING_TEMPLATE = '{ name = [[${name}]], desc = [=[${desc}]=] }'
local WEAPON_ENTRY_TEMPLATE_9E = '{ name="${name}", range=[[${range}]], type="${type}", s="${s}", ap="${ap}", d="${d}", abilities=[[${abilities}]] }'
local WEAPON_ENTRY_TEMPLATE_10E11E = '{ name="${name}", range=[[${range}]], a="${a}", bsws="${bsws}", s="${s}", ap="${ap}", d="${d}", abilities=[[${abilities}]], shortabilities=[[${shortabilities}]] }'
local CHANGING_CHARACTERISTICS_ENTRY_TEMPLATE = '["${name}"] = { "${characteristics}" }'
local WOUND_TRACK_ENTRY_TEMPLATE = [[       ["${name}"] = {
            ${tracks}
        }]]
local PSYKER_PROFILE_TEMPLATE = [[      ["${name}"] = ${profiles}]]
local PSYCHIC_POWER_TEMPLATE = [[${name} (${warpCharge}, ${range})]]
local PSYCHIC_POWER_ENTRY_TEMPLATE = '{ name="${name}", warpCharge="${warpCharge}", range=[[${range}]], details=[[${details}]] }'





local YELLOW_STORAGE_GUID = "43ecc1"
local ARMY_BOARD_GUID = "2955a6"
local DELETION_ZONE_GUID = "f33dff"
--local AGENDA_MANAGER_GUID = "45cd3f"
local IS_IN_HOME_MOD
local yellowStorage,YELLOW_STORAGE_XML,YELLOW_STORAGE_SCRIPT,army,armyBoard,uiHeight,uiWidth,edition
local SLOT_POINTS = {slot={},boundingBox={},placed={},models={}}
local SLOTS_TO_DISPLAY = {
    "slot",
    "boundingBox",
    "placed",
    "models"
}
local DEFAULT_MODEL_SPACING = 0.15
local DEFAULT_FOOTPRINT_PADDING = 0.5
local BOUNDING_BOX_RATIO = 2
local MODEL_PLACEMENT_Y = 5.4
local ARMY_PLACEMENT_STARTING_X = -5
local ARMY_PLACEMENT_STARTING_Z = -7
local WEAPON_TYPE_VALUES = {
    ["rapid fire"] = 0,
    ["assault"] = 0,
    ["heavy"] = 0,
    ["macro"] = 0,
    ["pistol"] = 1,
    ["grenade"] = 2,
    ["melee"] = 3
}
local CREATE_ARMY_BUTTON = {
    label="CREATE ARMY",
    click_function="createArmy",
    function_owner=self,
    position={12.2,0.60,14.3},
    rotation={180,0,180},
    height=640,
    width=2750,
    scale={1.2,1.2,1.2},
    font_size=300,
    font_style = "Bold",
    font_color={0,0,0},
    color={255,255,0}
}
local RESET_YELLOWSCRIBE_BUTTON = {
    label="Reset",
    click_function="resetYellowscribe",
    function_owner=self,
    position={12.2,0.60,11.6},
    rotation={180,0,180},
    height=430,
    width=1500,
    scale={1.2,1.2,1.2},
    font_size=300,
    font_style = "Bold",
    font_color={0,0,0},
    color={210,0,0}
}

function resetYellowscribe()
    UI.hide("mainPanel")
    UI.setAttribute("loadedScrollContainer", "active", false)
    self.reload()
    print("Yellowscribe reset!")
end

local ON_BUTTON = {
    label="Launch Yellowscribe",
    click_function="turnOnYellowMachine",
    function_owner=self,
    position={12.2,0.60,14.3},
    rotation={180,0,180},
    height=640,
    width=2950,
    scale={1.2,1.2,1.2},
    font_size=300,
    font_style = "Bold",
    font_color={0,0,0},
    color={255,255,0}
}


local modelAssociations,activeButtons = {},{}
local numAssociatedObjects,firstModelAssociation = 0,true
local ERROR_RED = { 1, 0.25, 0.25 }

local function safeSort(arr, comparator)
    if arr == nil then return end
    local n = #arr
    if n < 2 then return end
    local items = {}
    for idx = 1, n do
        table.insert(items, arr[idx])
    end
    for idx = n, 1, -1 do
        table.remove(arr, idx)
    end
    while #items > 0 do
        local bestIdx = 1
        for i = 2, #items do
            if comparator(items[i], items[bestIdx]) then
                bestIdx = i
            end
        end
        table.insert(arr, items[bestIdx])
        table.remove(items, bestIdx)
    end
end




function moveToLoadingScreen()
    if armyText ~= nil and armyText ~= "" then
        if #armyText == 8 then
            loadedData = nil
            UI.hide("welcomeWindow")
            UI.show("loading")
            Wait.time(|| sendRequest(armyText), 0.2)
        else
            broadcastToAll("It looks like your Yellowscribe code is malformed, please make sure to enter it correctly!", ERROR_RED)
            return
        end
    else
        broadcastToAll("Please paste your code into the box before clicking submit!", ERROR_RED)
        return
    end

    Wait.time(function () -- delay so that animations dont blend
        Wait.condition(function ()
            if loadedData.err == nil then

                loadEditedArmy(loadedData)
            else
                UI.hide("loading")
                -- wait because sometimes the response comes back before the loading screen even shows up
                Wait.time(function ()
                    broadcastToAll(loadedData.err, ERROR_RED)
                    UI.show("welcomeWindow")
                end, 0.2)
            end
        end,
        || loadedData ~= nil,
        20,
        function ()
            UI.hide("loading")
            broadcastToAll("Something has gone horribly wrong! Please try again.", ERROR_RED)
            UI.show("welcomeWindow")
        end)
    end, 0.15)
end

function sendRequest(data)
    -- Perform the request
    log(url..data)
    WebRequest.get(url..data, handleResponse)
end

function handleResponse(response)
    -- Check if the request failed to complete e.g. if your Internet connection dropped out.
    if response.is_error then
        broadcastToAll("Something went wrong at the server!", ERROR_RED)
        log(response.text)
        return
    end

    local data = JSON.decode(response.text)

    if data.err ~= nil then
        loadedData = data
    else
        loadedData = {}
        loadedData.uiHeight = data.uiHeight
        loadedData.uiWidth = data.uiWidth
        YELLOW_STORAGE_SCRIPT = data.baseScript
        loadedData.armyData = data.armyData
        loadedData.height = data.height
        loadedData.xml = data.xml
        loadedData.order = data.order
        loadedData.useDecorativeNames = data.decorativeNames == "true"
        loadedData.edition = data.edition
    end
end

function updateArmyInputText(player, text)
    armyText = text
end

function acceptEditedArmy()
    UI.hide("mainPanel")
    loadEditedArmy({ -- args sent as table because this used to be Global and I'm too lazy to rewrite it
        data = loadedData,
        order = originalLoadedOrder,
        uiHeight = uiHeight,
        uiWidth = uiWidth,
        useDecorativeNames = useDecorativeNames
    })
end

function turnOnYellowMachine()
    showWindow("welcomeWindow")
end

function closeWelcomeWindow(player, text)
    UI.hide("mainpanel")
end






--[[ EVENT HANDLERS ]]--

function onLoad()
    yellowStorage = getObjectFromGUID(YELLOW_STORAGE_GUID)
    YELLOW_STORAGE_XML = yellowStorage.getData().XmlUI
    YELLOW_STORAGE_SCRIPT = yellowStorage.getLuaScript()

        self.createButton(ON_BUTTON)
end

function onScriptingButtonDown(index, player_color)
    --slotPoints = { {5,1,5}, {-5,1,-5} }
    if DEBUG then
        Global.setVectorLines(SLOT_POINTS[SLOTS_TO_DISPLAY[index]])
    end
end

function onPlayerAction(player, action, targets)
    if action == Player.Action.PickUp and #activeButtons > 0 then
        makeSureObjectsAreAttached(targets)

        local intendedTargets

        if #player.getSelectedObjects() == 0 then
            intendedTargets = { player.getHoverObject() }
        else
            intendedTargets = player.getSelectedObjects()

            if not includes(intendedTargets, player.getHoverObject()) then
                table.insert(intendedTargets, player.getHoverObject())
            end
        end

        local targetsData = map(intendedTargets, function (target)
            local data = target.getData()

            data.States = nil

            return data
        end)

        for _,activeButton in pairs(activeButtons) do
            local buttonModel = army[activeButton.unit].models.models[activeButton.model]

            buttonModel.associatedModels = targetsData

            -- its ok if we overwrite this every time, we only ever need one and they shooould be all the same
            buttonModel.associatedModelBounds = intendedTargets[1].getBoundsNormalized()

            UI.setAttributes(activeButton.buttonID, {
                color = "#24d11e"
            })
        end

        for _,target in ipairs(intendedTargets) do
            target.highlightOn({ r=51/255, g=1, b=51/255 }, 2)
        end

        activeButtons = {}
    end
end





--[[ MODEL SELECTION ]]--


function selectModelGroup(player,_, unitAndModelID)
    local idValues = split(unitAndModelID, "|")
    local unitID,modelID = idValues[1], idValues[2]
    local sameButtonIndex = find(map(activeButtons, |button| button.buttonID), unitAndModelID)

    if sameButtonIndex > 0 then
        local assoc = army[unitID].models.models[modelID].associatedModels
        if assoc ~= nil then
            for _,modelData in ipairs(assoc) do
                getObjectFromGUID(modelData.GUID).highlightOff()
            end
        end
        army[unitID].models.models[modelID].associatedModels = nil
        table.remove(activeButtons, sameButtonIndex)
        UI.setAttribute(unitAndModelID, "color", "White")
    else
        table.insert(activeButtons, { unit = unitID, model = modelID, buttonID = unitAndModelID })
        UI.setAttribute(unitAndModelID, "color", "#e0e40b")

        if #activeButtons == 1 then -- if it's the first button selected
            broadcastToAll("Pick up a model (or models) to represent your selection!", {r=1, g=0, b=202/255})
        end
    end
end

function showAssociatedModel(_,_, button)
    highlightAssociatedModel(button, true)
end

function hideAssociatedModel(_,_, button)
    highlightAssociatedModel(button, false)
end

function highlightAssociatedModel(unitAndModelID, on)
    local idValues = split(unitAndModelID, "|")
    local buttonModel = army[idValues[1]].models.models[idValues[2]]

    if buttonModel.associatedModels ~= nil and #buttonModel.associatedModels > 0 then
        for _,associatedModel in ipairs(buttonModel.associatedModels) do
            local object = getObjectFromGUID(associatedModel.GUID)

            if object ~= nil then
                if on then
                    object.highlightOn({ r=51/255, g=1, b=51/255 })
                else
                    object.highlightOff()
                end
            end
        end
    end
end

function makeSureObjectsAreAttached(objects)
    for _,attachmentSet in ipairs(getObjectsToAttach(filter(objects, |object| #object.getJoints() > 0))) do
        for _,jointedObj in pairs(attachmentSet.toAttach) do
            if attachmentSet.lowestObj ~= jointedObj then
                attachmentSet.lowestObj.addAttachment(jointedObj)
            end
        end
    end
end

function getObjectsToAttach(objects)
    local toAttach = {}

    for _,object in ipairs(objects) do
        local attachmentSet = getObjectsToAttachRecursive(object, {}, {
            lowestY = object.getPosition().y,
            lowestObj = object,
            toAttach = { [object.getGUID()]=object }
        })

        for guid,_ in pairs(attachmentSet.toAttach) do
            for _,set in ipairs(toAttach) do
                if set.toAttach[guid] ~= nil then
                    mergeAttachmentSets(attachmentSet, set)
                    goto afterInsert
                end
            end
        end

        table.insert(toAttach, attachmentSet)
        ::afterInsert::
    end

    return toAttach
end

function getObjectsToAttachRecursive(object, found, toAttachTable)
    for _,joint in ipairs(object.getJoints()) do
        if found[joint.joint_object_guid] == nil then
            local jointedObj = getObjectFromGUID(joint.joint_object_guid)
            local jointedObjY = jointedObj.getPosition().y

            found[joint.joint_object_guid] = true
            toAttachTable.toAttach[joint.joint_object_guid] = jointedObj

            if jointedObjY < toAttachTable.lowestY then
                toAttachTable.lowestY = jointedObjY
                toAttachTable.lowestObj = jointedObj
            end

            getObjectsToAttachRecursive(jointedObj, found, toAttachTable)
        end
    end

    return toAttachTable
end

function mergeAttachmentSets(setToMerge, mergeIntoSet)
    for guid,obj in pairs(setToMerge.toAttach) do
        if mergeIntoSet.toAttach[guid] == nil then
            mergeIntoSet.toAttach[guid] = obj
        end
    end

    if setToMerge.lowestY < mergeIntoSet.lowestY then
        mergeIntoSet.lowestY = setToMerge.lowestY
        mergeIntoSet.lowestObj = setToMerge.lowestObj
    end
end








--[[ ARMY CREATION ]]--

-- formats and creates the army based on selected models
function createArmy()
    -- we only want to create models for ones that have a model selected
    local unitsToCreate = filter(army, function (unit)
        unit.models.models = filter(unit.models.models, function (model)
            if model.associatedModels == nil or #model.associatedModels == 0 then
                -- make sure we are spawning thr right number of models if only part of a unit is beign spawned
                unit.models.totalNumberOfModels = unit.models.totalNumberOfModels - model.number
            end

            return model.associatedModels ~= nil and #model.associatedModels > 0
        end)

        return len(unit.models.models) > 0
    end)

    if len(unitsToCreate) == 0 then
        broadcastToAll("You haven't selected any models!", ERROR_RED)
        return
    end

    -- delete anything that might get in the way in the future
    deleteAllObjectsInCreationZone()

    -- this feels so inefficient to go through the array so many times,
    -- but at this point, the array really shouldn't be that long,
    -- so I dont have to worry too much about big-O
    unitsToCreate = map(unitsToCreate, function (unit)
        if unit.models.models ~= nil then
            safeSort(unit.models.models, function(modelA, modelB) return modelA.number < modelB.number end)
        end

        --[[ for _,model in ipairs(unit.models.models) do
            model.associatedModel = getObjectFromGUID(model.associatedModel)
        end --]]

        unit.footprint = determineFootprint(unit)

        return unit
    end)
    safeSort(unitsToCreate, function (unitA, unitB)
        if unitA.footprint.width == unitB.footprint.width then
            return unitB.footprint.height < unitA.footprint.height
        end

        return unitA.footprint.width > unitB.footprint.width
    end)

    local selfPosition = self.getPosition()

    -- at this point, we should have a list of units sorted by width then height of their footprints
    placeArmy(unitsToCreate, ARMY_PLACEMENT_STARTING_X + selfPosition.x, ARMY_PLACEMENT_STARTING_Z + selfPosition.z, selfPosition.y)
end


function placeArmy(unitMap, startingX, startingZ, startingY)
    local emptySlots = {} -- {{x,z,h,w},...}
    local boundingBox = { h=0, w=0 }

    for _,unit in pairs(unitMap) do
        local placedInEmptySlot = false

        -- try to place at an origin
        for idx,slot in ipairs(emptySlots) do
            if unit.footprint.height <= slot.h and unit.footprint.width <= slot.w then
                placeUnit(unit, startingX-slot.x, startingZ+slot.z, startingY)

                if DEBUG then
                    table.insert(SLOT_POINTS.placed, { points= {
                        {startingX-slot.x,MODEL_PLACEMENT_Y+1,startingZ+slot.z},
                        {startingX-slot.x-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+slot.z},
                        {startingX-slot.x-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+slot.z+unit.footprint.height},
                        {startingX-slot.x,MODEL_PLACEMENT_Y+1,startingZ+slot.z+unit.footprint.height},
                        {startingX-slot.x,MODEL_PLACEMENT_Y+1,startingZ+slot.z}
                    },
                    color = {0,0,0}})
                end

                table.remove(emptySlots, idx)

                -- slot to the side should be filled first if possible
                -- so insert the top one first
                if (slot.h - unit.footprint.height) >= 1 then
                    if DEBUG then
                        table.insert(SLOT_POINTS.slot,{points= {
                            {startingX-slot.x,MODEL_PLACEMENT_Y+1,startingZ+slot.z+unit.footprint.height},
                            {startingX-slot.x-slot.w,MODEL_PLACEMENT_Y+1,startingZ+slot.z+unit.footprint.height},
                            {startingX-slot.x-slot.w,MODEL_PLACEMENT_Y+1,startingZ+slot.z+slot.h},
                            {startingX-slot.x,MODEL_PLACEMENT_Y+1,startingZ+slot.z+slot.h},
                            {startingX-slot.x,MODEL_PLACEMENT_Y+1,startingZ+slot.z+unit.footprint.height}
                        },
                        color = {0,1,0}})
                    end

                    table.insert(emptySlots, {
                        x = slot.x,
                        z = slot.z + unit.footprint.height,
                        h = slot.h - unit.footprint.height,
                        w = slot.w
                    })
                end

                if (slot.w - unit.footprint.width) >= 1 then
                    if DEBUG then
                        table.insert(SLOT_POINTS.slot,{ points = {
                            {startingX-slot.x-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+slot.z},
                            {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ+slot.z},
                            {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ+slot.z+unit.footprint.height},
                            {startingX-slot.x-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+slot.z+unit.footprint.height},
                            {startingX-slot.x-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+slot.z}
                        },
                        color = {0,0,1}})
                    end

                    table.insert(emptySlots, {
                        x = slot.x + unit.footprint.width,
                        z = slot.z,
                        w = slot.w - unit.footprint.width,
                        h = unit.footprint.height
                    })
                end
                -- >= 1 because we dont want to make additional tiny slots that will never be filled

                placedInEmptySlot = true
                break;
            end
        end

        if placedInEmptySlot then -- do nothing

        -- if expanding upward makes sense
        elseif (boundingBox.h + unit.footprint.height) < (boundingBox.w * BOUNDING_BOX_RATIO) then
            placeUnit(unit, startingX, startingZ + boundingBox.h, startingY)

            if DEBUG then
                table.insert(SLOT_POINTS.placed, { points= {
                    {startingX,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h},
                    {startingX-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h},
                    {startingX-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h+unit.footprint.height},
                    {startingX,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h+unit.footprint.height},
                    {startingX,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h}
                },
                color = {0,0,0}})
            end

            if (boundingBox.w - unit.footprint.width >= 1) then
                if DEBUG then
                    table.insert(SLOT_POINTS.slot, { points= {
                        {startingX-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h},
                        {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h},
                        {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h+unit.footprint.height},
                        {startingX-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h+unit.footprint.height},
                        {startingX-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h}
                    },
                    color = {1,0,1}})
                end

                table.insert(emptySlots, {
                    x = unit.footprint.width,
                    z = boundingBox.h,
                    h = unit.footprint.height,
                    w = boundingBox.w - unit.footprint.width
                })
            end

            boundingBox.h = boundingBox.h + unit.footprint.height

        -- else place at far left
        else
            placeUnit(unit, startingX - boundingBox.w, startingZ, startingY)

            if DEBUG then
                table.insert(SLOT_POINTS.placed, { points= {
                    {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ},
                    {startingX-boundingBox.w-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ},
                    {startingX-boundingBox.w-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+unit.footprint.height},
                    {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ+unit.footprint.height},
                    {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ}
                },
                color = {0,0,0}})
            end

            if boundingBox.h - unit.footprint.height >= 1 then
                if DEBUG then
                    table.insert(SLOT_POINTS.slot, { points= {
                        {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ+unit.footprint.height},
                        {startingX-boundingBox.w-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+unit.footprint.height},
                        {startingX-boundingBox.w-unit.footprint.width,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h},
                        {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ+boundingBox.h},
                        {startingX-boundingBox.w,MODEL_PLACEMENT_Y+1,startingZ+unit.footprint.height}
                    },
                    color = {0,0,0}})
                end

                table.insert(emptySlots, {
                    x = boundingBox.w,
                    z = unit.footprint.height,
                    h = boundingBox.h - unit.footprint.height,
                    w = unit.footprint.width
                })
            end

            boundingBox.w = boundingBox.w + unit.footprint.width

            if boundingBox.h == 0 then boundingBox.h = unit.footprint.height end -- handle first unit
        end
    end

    if DEBUG then
        SLOT_POINTS.boundingBox = {{
            points= {
                {startingX, MODEL_PLACEMENT_Y+1, startingZ},
                {startingX-boundingBox.w, MODEL_PLACEMENT_Y+1, startingZ},
                {startingX-boundingBox.w, MODEL_PLACEMENT_Y+1, startingZ+boundingBox.h},
                {startingX, MODEL_PLACEMENT_Y+1, startingZ+boundingBox.h},
                {startingX, MODEL_PLACEMENT_Y+1, startingZ},
            },
            color = {0,0,0}
        }}
    end

    local boardPosition = { x=startingX-(boundingBox.w*0.5), y=4+startingY, z=startingZ+(boundingBox.h * 0.5) }
    local boardScale = { x=(0.5*boundingBox.w), y=1, z=(0.5*boundingBox.h)}

    if armyBoard == nil then
        armyBoard = spawnObject({
            type = "Custom_Tile",
            sound = false,
            position = boardPosition,
            scale = boardScale
        })
        armyBoard.setCustomObject({
            image = "https://steamusercontent-a.akamaihd.net/ugc/1698405413696745750/BC055E0445A3CEC1A0A0754CF4F1646977612B09/",
            thickness = 0.20
        })
        armyBoard.setLock(true)
    else
        armyBoard.setScale(boardScale)
        armyBoard.setPosition(boardPosition)
    end
end


function placeUnit(unit, startX, startZ, startY)
    -- cheap way of determining a "sergeant" model:
    -- sort by number, pick the first, hope for the best
    local isFirstModel = true
    local xOffset = startX - DEFAULT_FOOTPRINT_PADDING -- left is negative
    local zOffset = startZ + DEFAULT_FOOTPRINT_PADDING -- up is positive
    local modelSize
    local currentRowHeight,currentModelsInRow = 0,0
    local leaderData = formatLeaderScript(unit)

    for modelID,model in pairs(unit.models.models) do
        --local currentModelObj = getObjectFromGUID(model.associatedModel)
        -- I dont remember why I'm passing the data as an object instead of just as arguments
        local modelProfile = getProfileForModel(model, unit)
        local modelDescription = buildModelDescription(model, unit, modelProfile)
        local modelNickname = (modelProfile ~= nil and ("[00ff16]"..modelProfile.w.."/"..modelProfile.w.."[-] ") or "")
                                ..getModelDisplayName(model, unit)
        local modelTags = getModelTags(model, unit)

        local modelData = formatModelData(model.associatedModels,
                                            modelDescription,
                                            modelNickname,
                                            modelTags)

        modelSize = model.associatedModelBounds.size
        --log(model)

        if currentRowHeight < modelSize.z then currentRowHeight = modelSize.z end

        for i=1,model.number do
            createModelFromData(chooseRandomModel(modelData),
                                --unit.decorativeName and unit.decorativeName or unit.name,
                                xOffset-(modelSize.x*0.5),
                                zOffset+(modelSize.z*0.5),
                                startY,
                                leaderData)
            table.insert(SLOT_POINTS.models,{ points = {
                {xOffset,MODEL_PLACEMENT_Y+1,zOffset},
                {xOffset-modelSize.x,MODEL_PLACEMENT_Y+1,zOffset},
                {xOffset-modelSize.x,MODEL_PLACEMENT_Y+1,zOffset+modelSize.z},
                {xOffset,MODEL_PLACEMENT_Y+1,zOffset+modelSize.z},
                {xOffset,MODEL_PLACEMENT_Y+1,zOffset}
            },
            color = {0,0,1}})
            leaderData = nil
            currentModelsInRow = currentModelsInRow + 1


            if currentModelsInRow == unit.modelsPerRow then
                currentModelsInRow = 0
                xOffset = startX - DEFAULT_FOOTPRINT_PADDING
                zOffset = zOffset + currentRowHeight + DEFAULT_MODEL_SPACING
            else
                xOffset = xOffset - (modelSize.x + DEFAULT_MODEL_SPACING)
            end
        end
    end
end

-- determines how much space a unit should take up once it is created
function determineFootprint(unit)
    -- determine models per row
    local modelsPerRow = unit.models.totalNumberOfModels
    local currentModelsInRow,currentWidth,footprintWidth,footprintHeight,modelsLeft = 0,0,0,0,0
    local currentRow = 1
    local currentHeights = {}
    local currentModelBounds

    if modelsPerRow > 5 then
        if modelsPerRow < 20 and modelsPerRow % 3 == 0 then
            if modelsPerRow < 12 then modelsPerRow = 3
            else modelsPerRow = modelsPerRow / 3 end
        elseif modelsPerRow < 20 and modelsPerRow % 5 == 0 then
            modelsPerRow = 5
        elseif modelsPerRow > 10 then
            modelsPerRow = 10
        end
    end

    unit.modelsPerRow = modelsPerRow

    -- I realize that this is doing almost exactly what we will do later when actually creating the models
    -- unfortunately, this is the only way that I can think of to guarantee the footprint of a unit
    -- with models of different sizes
    for _,model in pairs(unit.models.models) do
        currentModelBounds = model.associatedModelBounds.size

        if currentHeights[currentRow] == nil or currentModelBounds.z > currentHeights[currentRow] then
            currentHeights[currentRow] = currentModelBounds.z
        end

        if (currentModelsInRow + model.number) >= modelsPerRow then
            currentWidth = currentWidth + ((modelsPerRow - currentModelsInRow) * (currentModelBounds.x + DEFAULT_MODEL_SPACING))

            if currentWidth > footprintWidth then footprintWidth = currentWidth end

            modelsLeft = model.number - (modelsPerRow - currentModelsInRow)
            currentRow = currentRow + 1

            while modelsLeft >= modelsPerRow do
                table.insert(currentHeights, currentModelBounds.z + DEFAULT_MODEL_SPACING)
                currentRow = currentRow + 1
                modelsLeft = modelsLeft - modelsPerRow
                currentWidth = (currentModelBounds.x + DEFAULT_MODEL_SPACING) * modelsPerRow
            end

            if modelsLeft > 0 then
                table.insert(currentHeights, currentModelBounds.z + DEFAULT_MODEL_SPACING)
                currentModelsInRow = modelsLeft
            end

            if currentWidth > footprintWidth then footprintWidth = currentWidth end

            currentWidth = currentModelsInRow * (currentModelBounds.x + DEFAULT_MODEL_SPACING)
        else
            currentWidth = currentWidth + (model.number * (currentModelBounds.x + DEFAULT_MODEL_SPACING))
            currentModelsInRow = currentModelsInRow + model.number
        end
    end

    --if footprintHeight == 0 then footprintHeight = currentHeight end -- in case it hasnt been set yet (usually only because a row hasnt been filled)
    for _,height in ipairs(currentHeights) do
        footprintHeight = footprintHeight + height
    end

    return { width = footprintWidth+(2*DEFAULT_FOOTPRINT_PADDING), height = footprintHeight+(2*DEFAULT_FOOTPRINT_PADDING) }
end

-- formats both the leader and follower model data from a given model
function formatModelData(associatedModels, description, nickname, tags)
    for _,modelData in ipairs(associatedModels) do
        modelData.Description = description
        modelData.Nickname = nickname
        modelData.Tags = tags
        -- make sure base data doesnt include any xml or luascript
        modelData.XmlUI = ""
        modelData.LuaScript = ""
        modelData.LuaScriptState = nil
    end

    return associatedModels
end


function formatLeaderScript(unit)
    return interpolate(UNIT_SPECIFIC_DATA_TEMPLATE, {
        edition = edition,
        unitName = unit.name,
        unitDecorativeName = (unit.decorativeName ~= nil and unit.decorativeName ~= "") and unit.decorativeName:gsub('"', '\\"') or unit.name,

        factionKeywords = table.concat(unit.factionKeywords, ", "), -- dont break xml   --map(unit.factionKeywords, |keyword| (keyword:gsub(">", "＞"):gsub("<", "＜")))

        keywords = table.concat(unit.keywords, ", "), -- dont break xml   --map(unit.keywords, |keyword| (keyword:gsub(">", "＞"):gsub("<", "＜")))

        abilities = getFormattedAbilities(unit.abilities, unit.rules),

        models = table.concat(map(unit.modelProfiles, function (profile)
            -- if the unit has brackets, treat each one as a separate model
            if unit.woundTrack ~= nil and unit.woundTrack[profile.name] then
                local toReturn = {}
                local originalName = profile.name
                local changing

                for key,bracket in pairs(unit.woundTrack[profile.name]) do
                    profile.name = originalName.." ("..key..")"
                    changing = tableToFlatString(profile)

                    -- this seems like an inefficient way of doing it, but was the easiest to come up with
                    for _,val in ipairs(bracket) do
                        changing = changing:gsub("%*", val:gsub('"', '\\"'), 1)
                    end

                    table.insert(toReturn, changing)
                end

                return table.concat(toReturn, ",\n\t\t")
            end

            -- otherwise, just add the model
            return tableToFlatString(profile)
        end), ",\n\t\t"),

        weapons = table.concat(map(unit.weapons, |weapon| interpolate((edition == "10e" or edition == "11e") and WEAPON_ENTRY_TEMPLATE_10E11E or WEAPON_ENTRY_TEMPLATE_9E, weapon)), ",\n\t\t"),

        endBracket = "]]",
        uuid = unit.uuid,
        height = uiHeight,
        width = uiWidth,

        changingCharacteristics = unit.woundTrack == nil and "" or interpolate(CHANGING_CHARACTERISTICS_TEMPLATE, {
            changingChars = formatChangingCharacteristics(unit)
        }),

        woundTrack = unit.woundTrack == nil and "" or "\twoundTrack = "..tableToString(map(unit.woundTrack, function (tracks, name)
            return interpolate(WOUND_TRACK_ENTRY_TEMPLATE, {
                tracks = table.concat(map(tracks, function (track, key)
                    local temp = '["'..key..'"] = { "'

                    temp = temp..table.concat(map(track, |val| (val:gsub('"', '\\"'))), '", "')

                    return temp..'" }'
                end), ",\n\t\t\t", start_index, end_index ),
                name = name
            })

        end), ",\n", true, "\t"),

        singleModel = (not unit.isSingleModel) and "" or ",\n\tisSingleModel = true",

        psychic = unit.psykerProfiles == nil and "" or ",\n\tpsykerProfiles = "..
            tableToString(map(unit.psykerProfiles, |profile| tableToFlatString(profile)), ",\n\t\t", true, "\t", "\t\t")..
            ",\n\tpowersKnown = "..
            tableToString(map(unit.powersKnown, |power| interpolate(PSYCHIC_POWER_ENTRY_TEMPLATE, power)), ",\n\t\t", true, "\t", "\t\t")
    })..YELLOW_STORAGE_SCRIPT
end

function formatChangingCharacteristics(unit)
    local changing = {}

    for _,profile in pairs(unit.modelProfiles) do
        for char,val in pairs(profile) do -- profile
            if val == "*" then
                if changing[profile.name] == nil then changing[profile.name] = {} end

                table.insert(changing[profile.name], char)
            end
        end
    end

    --[[ for name,_ in pairs(unit.woundTrack) do

        changing[name] = {}

        for char,val in pairs(unit.modelProfiles[name]) do -- profile
            if val == "*" then table.insert(changing[name], char) end
        end
    end --]]

    local toReturn = {}

    for name,arr in pairs(changing) do
        table.insert(toReturn, interpolate(CHANGING_CHARACTERISTICS_ENTRY_TEMPLATE, {
            characteristics = table.concat(arr, '", "'),
            name = name
        }))
    end

    return table.concat(toReturn, ",\n\t\t")
end

function getModelDisplayName(model, unit)
    if unit.isSingleModel or useDecorativeNames then
        if unit.decorativeName ~= nil and unit.decorativeName ~= "" then
            return unit.decorativeName
        else
            return model.name
        end
    end

    return model.name
end

function getModelTags(model, unit)
    local tags = { "uuid:"..unit.uuid }

    if unit.woundTrack ~= nil then
        for key,_ in pairs(unit.woundTrack) do
            if key == model.name then table.insert(tags, "wt:"..model.name)
            -- this is a special case for Armigers (i.e. units that have multiple of the same model that has a wound track)
            -- where the data source creator named the profile in the plural ("Armigers")
            elseif key == model.name.."s" then table.insert(tags, "wt:"..model.name.."s") end
        end
    end

    return tags
end

-- Combine abilities and rules and format them properly to be displayed in a unit's datasheet
function getFormattedAbilities(abilities, rules)
    local abilitiesString = table.concat(map(abilities, function (ability)
        ability.name = ability.name:gsub("%[", "("):gsub("%]", ")") -- try not to break formatting

        return interpolate(ABILITITY_STRING_TEMPLATE, ability)
    end), ",\n\t\t")

    if #rules > 0 then
        abilitiesString = abilitiesString..
                            (len(abilities) > 0 and ",\n\t\t" or "")..
                            interpolate(ABILITITY_STRING_TEMPLATE, {
                                name="Additional Rules\n(see the books)",
                                desc = table.concat(map(rules, |rule| (rule:gsub("%[", "("):gsub("%]", ")"))), ", ")-- try not to break formatting
                            })
    end

    return abilitiesString
end

-- chooses a random model from the given array
-- technically this is a general method that could be used for selecting
-- a random value from any array
function chooseRandomModel(modelArray)
    if #modelArray == 1 then return modelArray[1] end
    if modelArray == nil or #modelArray == 0 then return nil end

    return modelArray[math.random(1, #modelArray)] -- both inclusive
end

-- spawns a model from the given data set
function createModelFromData(modelData, x, z, y, leaderModelScript)
    if leaderModelScript ~= nil then
        modelData = clone(modelData) -- prevent weird things with tables being treated as references
        table.insert(modelData.Tags, "leaderModel")
        modelData.XmlUI = YELLOW_STORAGE_XML
        modelData.LuaScript = leaderModelScript
    end

    local spawnData = {
        data = modelData,
        position = {
            x = x,
            y = MODEL_PLACEMENT_Y+y,
            z = z
        },
        rotation = { x=0, y=180, z=0 }, -- this seems right for most (but not all models)
    }

    spawnObjectData(spawnData)
end

-- finds the appropriate characteristic profile for the given model in the given unit
function getProfileForModel(model, unit)
    local otherModelsProfile = nil

    -- This is for compatibility with Crusade F2P. Crusade F2P generates a slightly tweaked form of
    -- army list where the profiles table is indexed by a unique ID instead of by name, and models then
    -- have a profileID property to precisely identify the correct profile, instead of relying on name
    -- matching. That allows multiple profiles to have the same name, which can be useful where
    -- identically-named models differ in wargear that alters their characteristics. This code
    -- is fine to execute against vanilla YellowScribe JSON as it'll simply never find a profileID.
    if model.profileID ~= nil then
        return unit.modelProfiles[model.profileID];
    end

    for _,profile in pairs(unit.modelProfiles) do
        if profile.name == model.name then
            return profile
        end

        if profile.name:lower() == "other models" then
            otherModelsProfile = profile
        end
    end
    -- if there arent any exactly matching profiles, try a more fuzzy search (both ways - profile name
    -- contains model name, and model name contains profile name)
    for _,profile in pairs(unit.modelProfiles) do
        local found = profile.name:find(model.name, 1, true) -- search for plain text (ie not pattern)
        if found ~= nil then return profile end

        found = model.name:find(profile.name, 1, true)
        if found ~= nil then return profile end
    end
       -- In 10th edition, at least one unit has "Other Models" as a catch-all
       if otherModelsProfile then
        return otherModelsProfile
    end
    -- if there arent any matching profiles, assume there's only one profile for every model in the unit
    for _,profile in pairs(unit.modelProfiles) do return profile end

    -- returns nil if not found
end

-- gets a model's description
function buildModelDescription(model, unit, modelProfile)
    return  formatCharDesc(modelProfile, unit)..
            formatWeaponDesc(model, unit, modelProfile ~= nil)..
            formatAbilityDesc(model, unit, modelProfile ~= nil)..
            formatPsychicDesc(model, unit, modelProfile ~= nil)
end

-- formats the characteristics section in a model's description
function formatCharDesc(modelProfile, unit)
    if modelProfile == nil then return "" end -- handles the rare case where a model just doesnt have a profile (eg Mekboy Workshop)

    local charHeadingString,charValueString = "[56f442]",""
    local currentChar = 1
    local woundTrack

    if unit.woundTrack ~= nil then
        if unit.woundTrack[modelProfile.name] ~= nil then
            woundTrack = map(unit.woundTrack[modelProfile.name], |v| v) -- make it array-like
        elseif len(unit.woundTrack) == 1 then
            for _,wt in pairs(unit.woundTrack) do
                woundTrack = map(wt, |v| v)
            end
        end
    end

    for heading,value in pairs(modelProfile) do
        if heading ~= "name" then
            if value == "*" and woundTrack ~= nil then
                value = woundTrack[1][currentChar]
                charValueString = charValueString..interpolate(DEFAULT_BRACKET_VALUE_TEMPLATE, { val=value }).."   "
                currentChar = currentChar + 1
            else
                charValueString = charValueString..(value == "-" and "  "..value or value).."   "
            end

            charHeadingString = charHeadingString..formatHeading(heading, value)
        end
    end

    charHeadingString = charHeadingString.."[-]\n"

    return charHeadingString..charValueString.."[-][-]" -- the double brackets at the end helps us to update brakcets if the unit has them
end

-- formats the heading line for the characteristics section in a model's description
-- the spacing is based on the values given so that they line up properly
function formatHeading(heading, value)
    local spacing = value:gsub("\\",""):len()-heading:len()

    if heading == "ws" or heading == "m" or heading =="a" then
        spacing = spacing + 2
    else
        spacing = spacing + 3
    end

    if (heading == "m" and value:len() > 2) or ((heading == "a" or heading == "s" or heading == "t" or heading == "w") and value:len() > 1) then
        if heading == "m" and value ~= "-" and value:find('%-') ~= nil then
            heading = heading.."   "
        end

        heading = " "..heading
    end

    return capitalize(heading)..string.rep(" ", spacing)
end

-- decides whether to fully capitalize or (in the case of ld and sv) titlecase a string
function capitalize(heading)
    if heading == "ld" or heading == "sv" then return titlecase(heading) end
    return heading:upper()
end

-- only use this for changing ld and sv to Ld and Sv
function titlecase(s)
    return s:gsub("^(%w)", |a| a:upper())
end

-- formats the string for the weapons section in a model's description
function formatWeaponDesc(model, unit, needSpacingBefore)
    if #model.weapons == 0 then return "" end

    local rangedWeapons = filter(model.weapons, |weapon| unit.weapons[weapon.name].range:lower() ~= "melee")
    local meleeWeapons = filter(model.weapons, |weapon| unit.weapons[weapon.name].range:lower() == "melee")

    local weapons = needSpacingBefore and "\n\n" or ""

    if #rangedWeapons > 0 then
        weapons = weapons .. "[e85545]Ranged weapons[-]"

        for _,weapon in pairs(rangedWeapons) do
            weapons = weapons.."\n"..formatWeapon(unit.weapons[weapon.name], weapon.number)
        end
    end

    if #meleeWeapons > 0 then
        if #rangedWeapons > 0 then weapons = weapons .. "\n\n" end
        weapons = weapons .. "[e85545]Melee weapons[-]"

        for _,weapon in pairs(meleeWeapons) do
            weapons = weapons.."\n"..formatWeapon(unit.weapons[weapon.name], weapon.number)
        end
    end

    return weapons
end

-- formats the string for a weapon entry in a model's description
function formatWeapon(weaponProfile, number)
    weaponName = number == 1 and weaponProfile.name or (number.."x "..weaponProfile.name)
    if edition == "10e" or edition == "11e" then
        if weaponProfile.range:lower() == "melee" then
            return  interpolate(MELEE_WEAPON_TEMPLATE_10E11E, {
                name = weaponName,
                a = weaponProfile.a,
                ws = weaponProfile.bsws,
                s = weaponProfile.s,
                ap = weaponProfile.ap,
                d = weaponProfile.d,
                ability = weaponProfile.shortAbilities == "-" and "" or "[" .. weaponProfile.shortAbilities .. "]"
            })
        else
            return  interpolate(RANGED_WEAPON_TEMPLATE_10E11E, {
                name = weaponName,
                range = weaponProfile.range,
                a = weaponProfile.a,
                bs = weaponProfile.bsws,
                s = weaponProfile.s,
                ap = weaponProfile.ap,
                d = weaponProfile.d,
                ability = weaponProfile.shortAbilities == "-" and "" or "[" .. weaponProfile.shortAbilities .. "]"
            })
        end
    else
        return  interpolate(WEAPON_TEMPLATE_9E, {
            name = weaponName,
            rangeAndType = (weaponProfile.range == "Melee") and "Melee" or weaponProfile.range.." "..weaponProfile.type,
            s = weaponProfile.s,
            ap = weaponProfile.ap,
            d = weaponProfile.d,
            ability = weaponProfile.abilities == "-" and "" or "Sp:*"
        })
    end
end

-- formats the string for the abilities section in a model's description
function formatAbilityDesc(model, unit, needSpacingBefore)
    if #model.abilities == 0 then return "" end

    return ((needSpacingBefore or #model.weapons > 0) and "\n\n" or "").."[dc61ed]Abilities[-]\n"..table.concat(model.abilities, "\n")
end


function formatPsychicDesc(model, unit)
    if unit.powersKnown == nil or #unit.powersKnown == 0 then return "" end

    return ((needSpacingBefore or #model.weapons > 0 or #model.abilities > 0) and "\n\n" or "")..
            "[5785fe]Psychic Powers[-]\n"..table.concat(map(unit.powersKnown, |power| interpolate(PSYCHIC_POWER_TEMPLATE, {
                name = power.name,
                warpCharge = power.warpCharge,
                range = power.range
            })), "\n")
end


function deleteAllObjectsInCreationZone()
    local deletionZone = getObjectFromGUID(DELETION_ZONE_GUID)

    if deletionZone == nil then return end

    for _,object in ipairs(deletionZone.getObjects()) do
        if object ~= armyBoard and object.getGUID() ~= YELLOW_STORAGE_GUID then
            object.setLuaScript("") -- prevent unintended consequences of destruction
            object.destruct() -- at this point the object is a different object because we reloaded it
        end
    end
end








--[[ INITIALIZATION HELPER FUNCTIONS ]]--



function showWindow(name)
    -- delay in case of update
    Wait.frames(function ()
        UI.setXml(self.UI.getXml())

        Wait.frames(function ()
            UI.setAttribute("mainPanel", "active", true)
            UI.show(name)
        end, 2)
    end, 2)
end






--[[ LOADING FROM GLOBAL UI ]]--


function loadEditedArmy(data)
    self.clearButtons()

    army = data.armyData
    edition = data.edition
    uiHeight = data.uiHeight
    uiWidth = data.uiWidth
    useDecorativeNames = data.useDecorativeNames
    --YELLOW_STORAGE_SCRIPT = armyData.baseScript -- yes I know I'm assigning a new value to something I marked as a constant, sue me

    local formattedArmyData = getLoadedArmyXML(data.order)

    if formattedArmyData.totalHeight < 1070 then
        UI.setAttributes("loadedScrollContainer", {
            noScrollbars = true,
            width = 400,
            height = 1070
        })
    else
        UI.setAttributes("loadedScrollContainer", {
            noScrollbars = false,
            width = 400,
            height = 1070
        })
    end

    UI.setAttribute("loadedContainer", "height", formattedArmyData.totalHeight)--formattedArmyData.totalHeight
    UI.setValue("loadedContainer", formattedArmyData.xml)
    UI.setAttribute("postLoading", "active", "false")
    UI.hide("postLoading")
    UI.setClass("mainPanel", "hiddenBigWindow")

    self.createButton(CREATE_ARMY_BUTTON)
    self.createButton(RESET_YELLOWSCRIBE_BUTTON)

    Wait.frames(function ()
        UI.hide("mainPanel")
        UI.setAttribute("loadedScrollContainer", "active", "true")
        UI.setXml(UI.getXml())
    end, 2)
end
function getLoadedArmyXML(order)
    local xmlString = ""
    local modelDataForXML, totalUnitContainerHeight
    local totalHeight = 0

    for _,uuid in ipairs(order) do
        local unit = army[uuid]
        local unitDataString = ""

        totalUnitContainerHeight = 30 -- name
        local cardCount = 0

        for modelID,model in pairs(unit.models.models) do
            cardCount = cardCount + 1
            modelDataForXML = getModelDataForXML(uuid, modelID, model, unit.weapons)
            unitDataString = unitDataString..interpolate(uiTemplates.MODEL_CONTAINER, modelDataForXML)
            totalUnitContainerHeight = totalUnitContainerHeight + modelDataForXML.height
        end

        if cardCount > 1 then
            totalUnitContainerHeight = totalUnitContainerHeight + 20 * (cardCount - 1) -- spacing
        end

        totalHeight = totalHeight + totalUnitContainerHeight + 30 -- total spacing between units

        xmlString = xmlString..interpolate(uiTemplates.UNIT_CONTAINER, {
            unitName = unit.decorativeName and unit.decorativeName or unit.name,
            unitData = unitDataString,
            height = totalUnitContainerHeight
        })
    end

    return { xml = xmlString, totalHeight = totalHeight }
end


function getModelDataForXML(unitID, modelID, model, characteristicProfiles)
    local weaponSection = ""
    local totalCardHeight = 28 -- padding(8) + modelDataName(20)

    if model.weapons ~= nil and #model.weapons > 0 then
        local weaponNames = {}
        for _, weapon in ipairs(model.weapons) do
            if weapon.number == 1 then
                table.insert(weaponNames, weapon.name)
            else
                table.insert(weaponNames, weapon.number.."x "..weapon.name)
            end
        end
        weaponSection = interpolate(uiTemplates.MODEL_DATA, {
            dataType = "Weapons:",
            data = table.concat(weaponNames, "\n"),
            height = 20 * #model.weapons
        })
        totalCardHeight = totalCardHeight + 36 + (20 * #model.weapons) -- spacer(6) + title(30) + data
    end

    return {
        modelName = model.name,
        numberString = model.number > 1 and (tostring(model.number).."x ") or "",
        weapons = weaponSection,
        unitID = unitID,
        modelID = modelID,
        height = totalCardHeight
    }
end











--[[ UTILITY FUNCTIONS ]]--


function interpolate(templateString, replacementValues)
    local result = templateString
    for key, val in pairs(replacementValues) do
        local target = "${" .. key .. "}"
        local valStr = tostring(val)
        local searchStart = 1
        while true do
            local startPos, endPos = result:find(target, searchStart, true)
            if not startPos then break end
            result = result:sub(1, startPos - 1) .. valStr .. result:sub(endPos + 1)
            searchStart = startPos + #valStr
        end
    end
    return result
end

function combine(tab1, tab2)
    if tab1 == nil then return clone(tab2) end
    if tab2 == nil then return clone(tab1) end

    local newTab = clone(tab1)

    for _,val in pairs(clone(tab2)) do
        table.insert(newTab, val)
    end

    return newTab
end

function clone(orig)
    local orig_type = type(orig)
    local copy
    if orig_type == 'table' then
        copy = {}
        for orig_key, orig_value in next, orig, nil do
            copy[clone(orig_key)] = clone(orig_value)
        end
        setmetatable(copy, clone(getmetatable(orig)))
    else -- number, string, boolean, etc
        copy = orig
    end
    return copy
end

function split(s, delimiter)
    local result = {};
    for match in (s..delimiter):gmatch("(.-)%"..delimiter) do
        table.insert(result, match);
    end
    return result;
end

function filter(t, filterFunc)
    local out = {}

    for k, v in pairs(clone(t)) do
      if filterFunc(v, k, t) then table.insert(out,v) end
    end

    return out
end

function includes (tab, val, checkKey)
    for index, value in ipairs(tab) do
        if checkKey ~= nil then
            if value[checkKey] == val[checkKey] then
                return true
            end
        else
            if value == val then
                return true
            end
        end
    end

    return false
end

function find(tab, val)
    for index, value in ipairs(tab) do
        if value == val then
            return index
        end
    end

    return -1
end

function filterKeepKeys(t, filterFunc)
    local out = {}

    for k, v in pairs(clone(t)) do
      if filterFunc(v, k, t) then out[k] = v end
    end

    return out
end

function map(t, mapFunc)
    local out = {}

    for k,v in pairs(clone(t)) do
        table.insert(out, mapFunc(v,k))
    end

    return out
end

function len(t)
    local count = 0

    for _,_ in pairs(t) do
        count = count + 1
    end

    return count
end

function trim(s)
    return s:match'^()%s*$' and '' or s:match'^%s*(.*%S)'
end

-- this should only ever be used with one dimensional tables
function tableToFlatString(t)
    return tableToString(t, ", ")
end

-- this is not a particularly robust solution, it is only really for my purposes in this script
-- thus, I very much do not recommend anyone copy this
-- note to self: can make it recursive to traverse multi-dimensional tables but eh
-- warnings:
--      this assumes a table is array-like if the key "1" exists,
--      this assumes all values are strings
function tableToString(t, delimiter, bracketsOnNewLine, extraTabbing, tabBeforeFirstElement)
    local out = "{ "
    local arrayLike = t[1] ~= nil

    if bracketsOnNewLine ~= nil and bracketsOnNewLine then
        out = out.."\n"..(tabBeforeFirstElement ~= nil and tabBeforeFirstElement or "")
    end

    out = out..table.concat(map(t, function (v,k)
        if arrayLike then return v end
        return k..'="'..v:gsub('"', '\\"')..'"'
    end), delimiter)

    if bracketsOnNewLine ~= nil and bracketsOnNewLine then
        return out.."\n"..(extraTabbing ~= nil and extraTabbing or "").."}"
    end

    return out.." }"
end

function removeModelByID(unitID, modelID)
    loadedData[unitID].models.models[modelID] = nil
end

function sortModels(tbl, sortFunction)
    local keys = {}

    for key in pairs(tbl) do
        table.insert(keys, key)
    end

    table.sort(keys, function(a, b)
        return sortFunction(tbl[a], tbl[b])
    end)

    return keys
end

function uuid()
    local template ='xxxxxxxx'
    return string.gsub(template, '[xy]', function (c)
        local v = (c == 'x') and math.random(0, 0xf) or math.random(8, 0xb)
        return string.format('%x', v)
    end)
end

function removeModelByID(unitID, modelID)
    loadedData[unitID].models.models[modelID] = nil
end

function sortModels(tbl, sortFunction)
    local keys = {}

    for key in pairs(tbl) do
        table.insert(keys, key)
    end

    table.sort(keys, function(a, b)
        return sortFunction(tbl[a], tbl[b])
    end)

    return keys
end
end)
__bundle_register("vscode/console", function(require, _LOADED, __bundle_register, __bundle_modules)
require("Console/console++")

-- function prototype
function onExternalCommand(command) end

-- Overwrite onChat function if you rather be handled by onExternalMessage
-- function onChat(message, player) end

function onExternalMessage(data)
  if data.input ~= nil then onExternalCommand(data.input) end
  if data.command ~= nil then
    local hostPlayer
    local players = getSeatedPlayers()
    for key, value in pairs(players) do
      if Player[value].host then
        hostPlayer = Player[value]
      end
    end
    if data.command ~= '' then
      local command = ''
      local command_function = nil
      local parameters = {hostPlayer}
      local requires_admin = false
      local command_mode = console.in_command_mode[hostPlayer.steam_id]
      if command_mode and console.active then
          command, command_function, parameters, requires_admin = console.get_command(data.command, hostPlayer)
      elseif data.command:sub(1, 1) == console.command_char and console.active then
          if data.command:len() > 1 then
              command, command_function, parameters, requires_admin = console.get_command(data.command:sub(2), hostPlayer)
          else
              command, command_function, parameters, requires_admin = console.get_command(console.command_char, hostPlayer)
          end
      else
          for i, f in ipairs(console.validation_functions) do
              local valid, response = f(data.command)
              if response == nil then response = '' end
              if not valid then
                  printToColor(response, hostPlayer.color, console.invalid_color)
                  return false
              end
          end
          return true
      end
      if console.active then
          if command_function and (hostPlayer.admin or not requires_admin) then
              if command_mode then
                  data.command = console.command_char .. console.command_char .. data.command
              end
              local response, mute = command_function(unpack(parameters))
              if response ~= nil or mute ~= nil then
                  if not mute then
                      printToColor('\n'..data.command, hostPlayer.color, console.command_color)
                  end
                  if response then
                      printToColor(response, hostPlayer.color, console.output_color)
                  end
              end
              if console.in_command_mode[hostPlayer.steam_id] then console.display_prompt(hostPlayer) end
              return false
          else
              printToColor('\n'..data.command, hostPlayer.color, console.command_color)
              printToColor(console.error_bb .. "<command '" .. command .. "' not found>[-]", hostPlayer.color, console.output_color)
              return false
          end
      end
    end
  end
end

end)
__bundle_register("Console/console++", function(require, _LOADED, __bundle_register, __bundle_modules)
require("Console/console")

if not console.plusplus then
    console.plusplus = true

    -- Change these values as you wish
    console.seperator         = '/'
    console.wildcard          = '*'
    console.literal           = '`'  -- string parameters will be treated as paths where apt unless prefixed with this
    console.result            = '~'  -- refers to the most recently returned result from a call
    console.command_seperator = ';'  -- used in batch files to seperate commands
    console.indent            = '  '
    console.crop_string_at = 20
    console.builtin_path = 'sys'
    console.table_bb    = '[EEDD88]'
    console.hidden_bb   = '[DDAAAA]'
    console.function_bb = '[AADDAA]'
    console.value_bb    = '[88EE88]'
    console.boolean_bb  = '[CCCCFF]'
    console.object_bb   = '[CCBBCC]'
    console.guid_bb     = '[BBBBBB]'

    console.autoexec         = ''
    console.autoexec_options = '-s'

    -- Exposed methods:

    function console.hide_globals(label)
        -- all globals present when you call this will be hidden under <label> (unless built-in or already hidden)
        local hidden = {}
        for global, _ in pairs(_G) do
            local found = false
            for _, globals in pairs(console.hidden_globals) do
                if globals[global] then
                    found = true
                    break
                end
            end
            if not found then
                table.insert(hidden, global)
            end
        end
        if console.hidden_globals[label] == nil then
            console.hidden_globals[label] = {}
        end
        for _, global in ipairs(hidden) do
            console.hidden_globals[label][global] = true
        end
    end

    function console.load()
        -- call this function in an onLoad event to enable the autoexec
        console.cd = console.seperator
        for _, player in pairs(getSeatedPlayers()) do
            if Player[player].admin then
                console.commands['exec'].command_function(Player[player], console.seperator..'console'..console.seperator..'autoexec', console.autoexec_options)
                break
            end
        end
    end

    function console.update()
        -- call this function in an onUpdate event to enable the watch list
        if console.watch_list and not console.watch_list_paused then
            for variable, watch in pairs(console.watch_list) do
                if watch.throttle == 0 or watch.last_check + watch.throttle < os.clock() then
                    watch.last_check = os.clock()
                    local node, id, parent, found
                    if watch.is_guid then
                        node = getObjectFromGUID(variable)
                        found = tostring(node) ~= 'null'
                    else
                        node, id, parent, found = console.node_from_path(variable)
                    end
                    if node ~= nil and found then
                        if type(node) == 'userdata' then
                            if tostring(node) ~= 'null' then
                                local p = function (x) return math.floor(x * 100) * 0.01 end
                                local r = function (x) return math.floor(x + 0.5) end
                                local position = node.getPosition()
                                local rotation = node.getRotation()
                                if p(position.x) ~= p(watch.position.x) or r(rotation.x) ~= r(watch.rotation.x) or
                                   p(position.y) ~= p(watch.position.y) or r(rotation.y) ~= r(watch.rotation.y) or
                                   p(position.z) ~= p(watch.position.z) or r(rotation.z) ~= r(watch.rotation.z) then
                                   watch.position = position
                                   watch.rotation = rotation
                                   node = ' ∡ '..r(rotation.x)..' '..r(rotation.y)..' '..r(rotation.z) ..
                                        console.boolean_bb..'   ⊞  '..p(position.x)..'   '..p(position.y)..'   '..p(position.z)
                                   if watch.is_guid then
                                       variable = console.format_guid(variable)
                                   else
                                       variable = console.object_bb .. variable .. '[-]'
                                   end
                                   printToColor(variable .. console.value_bb .. node .. '[-]', watch.player, console.output_color)
                                end
                            end
                        elseif type(node) == 'function' then
                            local result = node(unpack(watch.parameters))
                            if watch.property and (type(result) == 'table' or type(result) == 'userdata') then
                                result = result[watch.property]
                                if type(result) == 'function' then
                                    result = result()
                                end
                            end
                            if result ~= watch.value then
                                watch.value = result
                                result = tostring(result)
                                if result:len() > console.crop_string_at then result = result:sub(1, console.crop_string_at) .. '...' end
                                if result:len() == 6 and watch.label:lower():find('guid') then result = console.format_guid(result) end
                                printToColor(watch.label .. console.value_bb .. result .. '[-]', watch.player, console.output_color)
                            end
                        else
                            if node ~= watch.value then
                                watch.value = node
                                if type(node) == 'boolean' then
                                    if node then
                                        node = 'true'
                                    else
                                        node = 'false'
                                    end
                                elseif type(node) == 'string' then
                                    if node:len() > console.crop_string_at then node = node:sub(1, console.crop_string_at):gsub('\n', ' ') .. '...' end
                                end
                                printToColor(variable .. ': ' .. console.value_bb .. node .. '[-]', watch.player, console.output_color)
                            end
                        end
                    end
                end
            end
        end
    end

    -- simple swear-blocking validation
    console.add_validation_function(
        function (message)
            local message = message:lower()
            for i, bad_word in pairs({'fuck', 'cunt'}) do
                if message:find(bad_word) then
                    return false, "No swearing!"
                end
            end
            return true
        end
    )

    -- End of exposed methods.  You shouldn't need to interact with anything below (under normal circumstances)


    -- override default prompt with one which displays current table
    function console.display_prompt(player)
        printToColor(console.cd .. ' ' .. console.command_char..console.command_char, player.color, console.prompt_color)
    end


    -- console++ follows

    console.cd = console.seperator
    console.hidden_globals = {}
    console.hide_globals(console.builtin_path)

    function console.is_hidden(label)
        for _, globals in pairs(console.hidden_globals) do
            if globals[label] then
                return true
            end
        end
        return false
    end

    function console.escape_bb(s)
        local s = tostring(s)
        if s == '' then
            return ''
        else
            local r = ''
            for c = 1, s:len() do
                local char = s:sub(c, c)
                if char == '[' then
                    r = r .. '[\u{200B}'
                elseif char == ']' then
                    r = r .. '\u{200B}]'
                else
                    r = r .. char
                end
            end
            return r
        end
    end

    function console.format_guid(guid)
        return console.guid_bb .. '⁅' .. guid .. '⁆[-]'
    end

    function console.fill_path(path)
        local path = path
        local filter = nil
        if path == nil then
            return console.cd, filter
        end
        local c = path:len()
        if path:sub(c) ~= console.seperator then
            local found = false
            while c > 0 do
                local char = path:sub(c, c)
                if char == console.wildcard then
                    found = true
                elseif char == console.seperator then
                    break
                end
                c = c - 1
            end
            if found then
                filter = '^'
                for i = c + 1, path:len() do
                    local char = path:sub(i, i)
                    if char == console.wildcard then
                        filter = filter .. '.*'
                    else
                        filter = filter .. char
                    end
                end
                filter = filter .. '$'
                path = path:sub(1, c)
            end
        end
        if path:sub(1,1) == console.seperator then
            return path, filter
        else
            return console.cd .. path, filter
        end
    end

    function console.node_from_path(path)
        local node = _G
        local id = {''}
        local parent = {nil}
        local found = true
        local depth = 0
        local stack = {}
        local hidden = nil
        local ends_with_table = {true}
        if path == 'true' then
            node = true
        elseif path == 'false' then
            node = false
        elseif path ~= console.seperator then
            for i, part in ipairs(console.split(path, console.seperator)) do
                if part == '..' then
                    if depth > 0 then
                        node = table.remove(parent)
                        table.remove(id)
                        table.remove(stack)
                        table.remove(ends_with_table)
                        depth = depth - 1
                    end
                elseif part == '.' then
                    ; -- do nothing, . = where we are
                elseif part == console.result then
                    table.insert(parent, node)
                    table.insert(id, part)
                    table.insert(stack, part)
                    node = console.returned_value
                    table.insert(ends_with_table, type(node) == 'table')
                    depth = depth + 1
                elseif node[part] ~= nil then
                    table.insert(parent, node)
                    table.insert(id, part)
                    table.insert(stack, part)
                    node = node[part]
                    table.insert(ends_with_table, type(node) == 'table')
                    depth = depth + 1
                elseif node == _G and console.hidden_globals[part] then
                    hidden = console.hidden_globals[part]
                else
                    table.insert(id, part)
                    found = false
                    break
                end
            end
        end
        path = ''
        for i, part in ipairs(stack) do
            path = path .. console.seperator .. part
        end
        if table.remove(ends_with_table) then
            path = path .. console.seperator
        end
        return node, table.remove(id), table.remove(parent), found, path, hidden
    end


    -- commands

    console.add_admin_command('cd', '[<table>]',
        'Display current table or change current table',
        function (player, path)
            if path == nil then
                return console.cd
            else
                path = tostring(path)
            end
            local location = console.fill_path(path)
            local node, id, parent, found, location = console.node_from_path(location)
            local text = nil
            if node ~= nil and found and type(node) == 'table' then
                console.cd = location
                if not console.in_command_mode[player.steam_id] then text = console.cd end
            else
                text = console.error_bb .. '<not found>[-]'
            end
            return text, false
        end
    )
    console.add_admin_command('cd..', '', 'Change current table to parent table.', 'cd', {'..'})

    console.add_admin_command('ls', '[' .. console.option .. '?afotv] [' .. console.option .. 'r[#]] [<table>]',
        'Display variables in current table or specified table',
        function (player, ...)
            local help_details = console.header_bb .. 'Options[-]\n' ..
                'Show:\n '..console.option..'f functions\n '..console.option..'o objects\n '..
                console.option..'v variables (defaults to on)\n '..console.option..'t tables (defaults to on)\n '..
                console.option..'a all\n\n' ..console.option..'r[#] recurse [# layers if specified]'
            local path = console.cd
            local display_functions = false
            local display_objects = false
            local display_variables = false
            local display_tables = false
            local display_all = false
            local recursions_left = 0
            for i, arg in ipairs({...}) do
                arg = tostring(arg)
                if arg:len() > 1 and arg:sub(1,1) == console.option then
                    local c = 2
                    while c <= arg:len() do
                        local option = arg:sub(c,c)
                        if option == 'f' then
                            display_functions = not display_functions
                        elseif option == 'o' then
                            display_objects = not display_objects
                        elseif option == 'v' then
                            display_variables = not display_variables
                        elseif option == 't' then
                            display_tables = not display_tables
                        elseif option == 'a' then
                            display_all = not display_all
                        elseif option == 'r' then
                            local n = ''
                            local j = c + 1
                            while j <= arg:len() do
                                local char = arg:sub(j, j)
                                if char:match('%d') then
                                    n = n .. char
                                else
                                    break
                                end
                                j = j + 1
                            end
                            c = j - 1
                            if n == '' then
                                recursions_left = 20
                            else
                                recursions_left = tonumber(n)
                            end
                        elseif option == '?' or option == 'h' then
                            return help_details
                        else
                            return console.error_bb .. "<option '" .. console.option .. option .. "' not recognized>[-]\n"
                        end
                        c = c + 1
                    end
                else
                    path = arg
                end
            end
            local default_variables = not (display_tables or display_objects or display_functions or display_variables)
            if display_functions or display_objects or display_variables then
                display_tables = not display_tables
            end
            if display_all then
                display_functions = true
                display_objects = true
                display_variables = true
                display_tables = true
            elseif default_variables then
                display_functions = false
                display_objects = false
                display_variables = true
                display_tables = true
            end
            local location, filter = console.fill_path(path)
            return console.ls(player, location, filter, display_functions, display_objects, display_variables, display_tables, recursions_left)
        end
    )
    console.add_admin_command('dir', nil, nil, 'ls')
    console.add_admin_command(console.result, '', "Calls 'ls "..console.option.."a "..console.result.."'", 'ls', {console.option..'a', console.result})

    function console.ls(player, path, filter, display_functions, display_objects, display_variables, display_tables, recursions_left, indent)
        local text = ''
        local indent = indent or ''
        local node, id, parent, found, location, hidden = console.node_from_path(path)
        local paths = {}
        if node ~= nil and (found or hidden) then
            if type(node) == 'table' then
                local tables = {}
                local entries = {}
                for k, v in pairs(node) do
                    if (node ~= _G or (not hidden and not console.is_hidden(k)) or (hidden and hidden[k])) and (filter == nil or k:match(filter)) then
                        if type(v) == 'table' then
                            local t = console.table_bb .. k .. '[-]'
                            table.insert(tables, t)
                            paths[t] = path .. console.seperator .. k
                        else
                            if type(v) == 'function' then
                                if display_functions then
                                    table.insert(entries, console.function_bb .. k .. '[-]()')
                                end
                            elseif type(v) == 'userdata' then
                                if display_objects then
                                    local tag = tostring(v)
                                    if tag:find('(LuaGameObjectScript)') and not tag:gsub('(LuaGameObjectScript)',''):find('Script ') then
                                        tag = v.tag .. ' ' .. console.format_guid(v.getGUID())
                                    end
                                    if type(k) == 'number' and math.floor(k) == k then k = string.format('%04d', k) end
                                    table.insert(entries, console.object_bb .. k .. '[-]: '  .. tag)
                                end
                            elseif display_variables then
                                if type(v) == 'boolean' then
                                    if v then
                                        v = 'true'
                                    else
                                        v = 'false'
                                    end
                                    table.insert(entries, k .. ': ' .. console.boolean_bb .. v .. '[-]')
                                else
                                    local is_guid = false
                                    if type(v) == 'string' then
                                        if v:len()> console.crop_string_at then v = v:sub(1, console.crop_string_at):gsub('\n', ' ') .. '...' end
                                        if type(k) == 'string' and k:lower():find('guid') and v:len() == 6 then
                                            is_guid = true
                                        end
                                    end
                                    if is_guid then
                                        table.insert(entries, k .. ': ' .. console.format_guid(v) .. '[-]')
                                    else
                                        table.insert(entries, k .. ': ' .. console.value_bb .. console.escape_bb(v) .. '[-]')
                                    end
                                end
                            end
                        end
                    end
                end
                local cmp = function (a, b)
                    if not a then
                        return true
                    elseif not b then
                        return false
                    else
                        local la = a:len()
                        local lb = b:len()
                        local c = 1
                        repeat
                            if c > la and c <= lb then
                                return true
                            elseif c > lb and c <= la then
                                return false
                            elseif c > la then
                                return false
                            else
                                local ba = a:sub(c, c):byte()
                                local bb = b:sub(c, c):byte()
                                if ba < bb then
                                    return true
                                elseif bb < ba then
                                    return false
                                end
                            end
                            c = c + 1
                        until false
                    end
                end
                table.sort(tables, cmp)
                table.sort(entries, cmp)
                local cr = ''
                if display_tables then
                    for i, t in ipairs(tables) do
                        text = text .. cr .. indent .. t .. console.seperator
                        if recursions_left ~= 0 then
                            text = text .. '\n' .. console.ls(player, paths[t], filter,
                                display_functions, display_objects, display_variables, display_tables,
                                recursions_left-1, indent..console.indent)
                        end
                        cr = '\n'
                    end
                    if node == _G and not hidden then
                        for label, _ in pairs(console.hidden_globals) do
                            if (filter == nil or label:match(filter)) then -- and label ~= console.builtin_path
                                text = text .. cr .. indent .. console.hidden_bb .. label .. console.seperator .. '[-]'
                                cr = '\n'
                            end
                        end
                    end
                end
                for _, entry in ipairs(entries) do
                    text = text .. cr .. indent .. entry
                    cr = '\n'
                end
            elseif type(node) == 'userdata' then
                local tag = tostring(node)
                if tag ~= 'null' and tag:find('(LuaGameObjectScript)') and not tag:gsub('(LuaGameObjectScript)',''):find('Script ') then
                    tag = node.tag .. ' ' .. console.format_guid(node.getGUID())
                end
                text = indent .. console.object_bb .. id .. '[-]: ' .. tag
            elseif type(node) == 'function' then
                text = indent .. console.function_bb .. id .. '[-]()'
            elseif type(node) == 'boolean' then
                if node then
                    text = indent .. id .. ': ' .. console.boolean_bb .. 'true[-]'
                else
                    text = indent .. id .. ': ' .. console.boolean_bb .. 'false[-]'
                end
            else
                if type(id) == 'string' and id:lower():find('guid') and type(node) == 'string' and node:len() == 6 then
                    text = indent .. id .. ': ' .. console.format_guid(node) .. '[-]'
                else
                    text = indent .. id .. ': ' .. console.value_bb .. console.escape_bb(node) .. '[-]'
                end
            end
        else
            text = indent .. console.error_bb .. '<not found>[-]'
        end
        return text
    end

    console.add_admin_command('call', '<function> [<parameter>...]',
        'Call function with parameters and display result.',
        function (player, ...)
            local path = nil
            local parameters = {}
            for i, arg in ipairs({...}) do
                if i == 1 then
                    path = tostring(arg)
                else
                    if type(arg) == 'string' then
                        if arg:len() > 2 and arg:sub(1,1) == console.literal then
                            arg = arg:sub(2)
                        else
                            local node, id, parent, found = console.node_from_path(console.fill_path(arg))
                            if node ~= nil and found then
                                arg = node
                            end
                        end
                    end
                    table.insert(parameters, arg)
                end
            end
            if path == nil then
                return console.error_bb .. '<you must supply a function>[-]'
            end
            local location = console.fill_path(path)
            local node, id, parent, found, location = console.node_from_path(location)
            local text = nil
            if node ~= nil and found and type(node) == 'function' then
                console.returned_value = node(unpack(parameters))
                text = tostring(console.returned_value)
                if console.deferred_assignment then
                    local da = console.deferred_assignment
                    if da.command == 'set' then
                        if da.parent[da.id] ~= nil then
                            if da.force or type(console.returned_value) == type(da.parent[da.id]) then
                                da.parent[da.id] = console.returned_value
                                text = text .. '\n' .. console.header_bb .. "<set '" .. da.id .. "'>[-]"
                            else
                                text = text .. '\n' .. console.error_bb .. "<cannot set '" .. da.id .. "': it is of type '" .. type(da.parent[da.id]) .. "'>[-]"
                            end
                        else
                            text = text .. '\n' .. console.error_bb .. "<cannot set '" .. da.id .. "': it does not exist>[-]"
                        end
                    elseif da.command == 'add' then
                        if da.parent[da.id] == nil then
                            da.parent[da.id] = console.returned_value
                            text = text .. '\n' .. console.header_bb .. "<added '" .. da.id .. "'>[-]"
                        else
                            text = text .. '\n' .. "<cannot add '" .. da.id .. "': it already exists>[-]"
                        end
                    end
                    console.deferred_assignment = nil
                end
            else
                text = console.error_bb .. '<not found>[-]'
            end
            return text, false
        end
    )

    console.add_admin_command('set', '['..console.option..'f] <variable> [<value>]',
        "Set variable to value.  If no value specified then the next value returned from 'call' is used.\n" ..
            console.option ..'f  force overwrite ignoring type',
        function (player, ...)
            local variable = nil
            local value = nil
            local force = false
            for _, arg in ipairs({...}) do
                if type(arg) == 'string' and arg:len() > 1 and arg:sub(1, 1) == console.option then
                    local c = 2
                    while c <= arg:len() do
                        local option = arg:sub(c, c)
                        if option == "f" then
                            force = not force
                        else
                            return console.error_bb .. "<option '" .. option .. "' not recognized>[-]"
                        end
                        c = c + 1
                    end
                elseif variable == nil then
                    variable = tostring(arg)
                else
                    value = arg
                end
            end
            if variable == nil then
                return console.error_bb .. '<you must supply a variable>[-]'
            end
            variable = console.fill_path(variable)
            local node, id, parent, found = console.node_from_path(variable)
            local text = ''
            if node ~= nil and found then
                if value == nil then
                    console.deferred_assignment = {command = 'set', parent = parent, id = id, force = force}
                    text = id .. ': ' .. console.header_bb .. "<awaiting 'call'>[-]"
                else
                    console.deferred_assignment = nil
                    if type(value) == 'string' and value:len() > 0  then
                        if value:sub(1, 1) == console.literal then
                            value = value:sub(2)
                        else
                            local value_node, value_id, value_parent, value_found = console.node_from_path(value)
                            if value_node ~= nil and value_found then
                                value = value_node
                            else
                                return console.error_bb .. '<not found>[-]'
                            end
                        end
                    end
                    if type(node) == 'boolean' then
                        if not value or tostring(value):lower() == 'false' then
                            value = false
                        else
                            value = true
                        end
                    end
                    if type(node) == type(value) or force then
                        parent[id] = value
                        text = id .. ': ' .. console.value_bb .. tostring(parent[id]) .. '[-]'
                    else
                        return console.error_bb .. "<cannot set '" .. id .. "': it is of type '" .. type(node) .. "'>[-]"
                    end
                end
            else
                text = console.error_bb .. '<not found>[-]'
            end
            return text
        end
    )

    console.add_admin_command('toggle', '<boolean>',
        'Toggle specified boolean variable',
        function (player, variable)
            if variable == nil then
                return console.error_bb .. '<you must supply variable>'
            else
                variable = tostring(variable)
            end
            local variable = console.fill_path(variable)
            local node, id, parent, found = console.node_from_path(variable)
            local text = ''
            if node ~= nil and found then
                if type(node) == 'boolean' then
                    if node then
                        parent[id] = false
                        text = id .. ': ' .. console.value_bb .. 'false[-]'
                    else
                        parent[id] = true
                        text = id .. ': ' .. console.value_bb .. 'true[-]'
                    end
                else
                    text = console.error_bb .. '<can only toggle a boolean>[-]'
                end
            else
                text = console.error_bb .. '<not found>[-]'
            end
            return text
        end
    )
    console.add_admin_command('tgl', nil, nil, 'toggle')

    console.add_admin_command('rm', '<variable>',
        'Remove specified variable',
        function (player, variable)
            if variable == nil then
                return console.error_bb .. '<you must supply variable>'
            else
                variable = tostring(variable)
            end
            local variable = console.fill_path(variable)
            local node, id, parent, found = console.node_from_path(variable)
            local text = ''
            if node ~= nil and found then
                parent[id] = nil
                text = id .. " removed!"
            else
                text = console.error_bb .. '<not found>[-]'
            end
            return text
        end
    )
    console.add_admin_command('del', nil, nil, 'rm')

    console.add_admin_command('add', '<variable> [<value>]',
        "Create a variable set to value.   If no value specified then the next value returned from 'call' is used.",
        function (player, variable, value)
            if variable == nil then
                return console.error_bb .. '<you must supply variable>[-]'
            else
                variable = tostring(variable)
            end
            local variable = console.fill_path(variable)
            local node, id, parent, found = console.node_from_path(variable)
            local text = ''
            if found then
                return console.error_bb .. '<already exists>[-]'
            elseif node == nil or id == '' then
                return console.error_bb .. '<not found>[-]'
            else
                if value == nil then
                    console.deferred_assignment = {command = 'add', parent = node, id = id}
                    text = id .. ': ' .. console.header_bb .. "<awaiting 'call'>[-]"
                else
                    console.deferred_assignment = nil
                    if type(value) == 'string' and value:len() > 0  then
                        if value:sub(1, 1) == console.literal then
                            value = value:sub(2)
                        else
                            local value_node, value_id, value_parent, value_found = console.node_from_path(value)
                            if value_node ~= nil and value_found then
                                value = value_node
                            else
                                return console.error_bb .. '<not found>[-]'
                            end
                        end
                    end
                    node[id] = value
                    text = id .. ': ' .. console.value_bb .. tostring(value) .. '[-]'
                end
            end
            return text
        end
    )

    console.add_admin_command('exec', '['..console.option..'?qsv] <commands>',
        'Execute a series of commands held in a string: commands are seperated by a new line or '..console.command_seperator,
        function (player, ...)
            local help_details = console.option..'q    quiet: will not output anything except final output\n' ..
                                 console.option..'s    silent: will not output anything at all\n'..
                                 console.option..'v    verbose: will output commands as they execute\n'
            local commands = nil
            local verbose = false
            local quiet = false
            local silent = false
            for _, arg in ipairs({...}) do
                if type(arg) == 'string' and arg:len() > 1 and arg:sub(1,1) == console.option then
                    local c = 2
                    while c <= arg:len() do
                        local option = arg:sub(c,c)
                        if option == '?' then
                            return help_details
                        elseif option == 'q' then
                            quiet = not quiet
                        elseif option == 's' then
                            silent = not silent
                        elseif option == 'v' then
                            verbose = not verbose
                        else
                            return console.error_bb .. "<option '" .. option .. "' not recognized>"
                        end
                        c = c + 1
                    end
                elseif commands == nil then
                    commands = tostring(arg)
                end
            end
            if silent then quiet = true end
            if commands:len() > 1 and commands:sub(1, 1) == console.literal then
                commands = commands:sub(2)
            else
                local variable = console.fill_path(commands)
                local node, id, parent, found = console.node_from_path(variable)
                if node ~= nil and found then
                    commands = node
                else
                    return console.error_bb .. '<not found>[-]'
                end
            end
            if commands:find('\n') then
                commands = console.split(commands, '\n')
            else
                commands = console.split(commands, console.command_seperator)
            end
            local end_result = nil
            for _, command_text in ipairs(commands) do
                local command = ''
                local command_function = nil
                local parameters = {player}
                local requires_admin = false
                command, command_function, parameters, requires_admin = console.get_command(command_text, player)
                if command ~= '' then
                    if command_function and (player.admin or not requires_admin) then
                        local response, mute = command_function(unpack(parameters))
                        if response ~= nil or mute ~= nil then
                            if not mute and verbose and not quiet then
                                printToColor('\n'..command_text, player.color, console.command_color)
                            end
                            if response then
                                end_result = response
                                if not quiet then
                                    printToColor(response, player.color, console.output_color)
                                end
                            end
                        end
                    elseif not quiet then
                        if verbose then printToColor('\n'..command_text, player.color, console.command_color) end
                        printToColor(console.error_bb .. "<command '" .. command .. "' not found>[-]", player.color, console.output_color)
                    end
                end
            end
            if end_result and not silent then
                printToColor(end_result, player.color, console.output_color)
            end
        end
    )

    console.add_admin_command('watch', '['..console.option..'?cgp] ['..console.option..'t#] ['..console.option..console.seperator..'<property>] [<variable>]',
        'Watch a variable or object and display it whenever it changes.\n' .. console.hidden_bb ..
        'Requires you to add a '..console.function_bb..'console.update()[-] call to an ' ..
        console.function_bb .. 'onUpdate[-] event in your code.[-]\n',
        function (player, ...)
            local help_details = 'Call without a parameter to display watched items, or with a variable to add it to watch list.\n' ..
                                console.option..'c will clear variable if specified, or all.\n' ..
                                console.option..'g will let you specify an object by its GUID.\n' ..
                                console.option..'t# will throttle output to # seconds.\n' ..
                                console.option..console.seperator..'<property> will watch the property of the variable.\n' ..
                                console.option..'p will pause or unpause watching.\n'
            local path = nil
            local clearing = false
            local throttle = nil
            local pause_changed = false
            local by_guid = false
            local parameters = {}
            local labels = {}
            local property = nil
            for _, arg in ipairs({...}) do
                if type(arg) == 'string' and arg:len() > 1 and arg:sub(1,1) == console.option then
                    local c = 2
                    while c <= arg:len() do
                        local option = arg:sub(c,c)
                        if option == '?' then
                            return help_details
                        elseif option == 'c' then
                            clearing = not clearing
                        elseif option == 'p' then
                            pause_changed = not pause_changed
                        elseif option == 'g' then
                            by_guid = not by_guid
                        elseif option == console.seperator then
                            if arg:len() > c then
                                property = arg:sub(c + 1)
                                c = arg:len() + 1
                            end
                        elseif option == 't' then
                            local n = ''
                            local j = c + 1
                            while j <= arg:len() do
                                local char = arg:sub(j, j)
                                if char:match('[0-9.]') then
                                    n = n .. char
                                else
                                    break
                                end
                                j = j + 1
                            end
                            c = j - 1
                            if n == '' then
                                return console.error_bb .. '<you must provide a throttle duration (in seconds)>[-]'
                            else
                                throttle = tonumber(n)
                            end
                        else
                            return console.error_bb .. "<option '" .. option .. "' not recognized>"
                        end
                        c = c + 1
                    end
                else
                    if path == nil then
                        path = tostring(arg)
                    else
                        local label = tostring(arg)
                        if type(arg) == 'string' then
                            if arg:len() > 2 and arg:sub(1,1) == console.literal then
                                arg = arg:sub(2)
                                label = arg
                            else
                                local node, id, parent, found = console.node_from_path(console.fill_path(arg))
                                if node ~= nil and found then
                                    arg = node
                                end
                            end
                        end
                        table.insert(labels, label)
                        table.insert(parameters, arg)
                    end
                end
            end
            local text = ''
            if pause_changed then
                if console.watch_list_paused then
                    console.watch_list_paused = nil
                    text = text .. console.header_bb .. '<unpaused>[-]'
                else
                    console.watch_list_paused = true
                    text = text .. console.header_bb .. '<paused>[-]'
                end
            end
            if path == nil then
                if throttle ~= nil then
                    text = text .. '\n' .. console.error_bb .. '<you must provide a variable or object>[-]'
                elseif by_guid then
                    text = text .. '\n' .. console.error_bb .. '<you must provide a GUID>[-]'
                elseif clearing then
                    console.watch_list = nil
                    console.watch_list_paused = nil
                    text = text .. '\nWatch list cleared!'
                elseif not pause_changed then
                    if console.watch_list then
                        local watched = {}
                        for label, watch in pairs(console.watch_list) do
                            if watch.player == player.color then
                                table.insert(watched, label)
                            end
                        end
                        table.sort(watched)
                        text = text .. '\n'..console.header_bb..'Watching:[-]'
                        for _, label in ipairs(watched) do
                            local watch = console.watch_list[label]
                            local is_guid = (label:len() == 6 and label:sub(1,1) ~= console.seperator)
                            local node, id, parent, found
                            local prefix
                            text = text .. '\n'
                            if is_guid then
                                prefix =  console.format_guid(label)
                                node = getObjectFromGUID(label)
                                found = tostring(node) ~= 'null'
                            else
                                prefix = label
                                node, id, parent, found = console.node_from_path(label)
                            end
                            if node ~= nil and found then
                                if type(node) == 'userdata' then
                                    prefix = console.object_bb .. prefix .. '[-]'
                                    local position = node.getPosition()
                                    local rotation = node.getRotation()
                                    local p = function (x) return math.floor(x * 100) * 0.01 end
                                    local r = function (x) return math.floor(x + 0.5) end
                                    text = text .. prefix .. console.value_bb .. ' ∡ '..r(rotation.x)..' '..r(rotation.y)..' '..r(rotation.z) .. '[-]'..
                                            console.boolean_bb..'   ⊞  '..p(position.x)..'   '..p(position.y)..'   '..p(position.z)
                                elseif type(node) == 'function' then
                                    local result = node(unpack(console.watch_list[label].parameters))
                                    if watch.property and (type(result) == 'table' or type(result) == 'userdata') then
                                        result = result[watch.property]
                                        if type(result) == 'function' then
                                            result = result()
                                        end
                                    end
                                    result = tostring(result)
                                    if watch.propery and watch.property:lower():find('guid') then
                                        result = console.format_guid(result)
                                    end
                                    if result:len() > console.crop_string_at then result = result:sub(1, console.crop_string_at) .. '...' end
                                    text = text .. watch.label .. console.value_bb .. result .. '[-]'
                                else
                                    if type(node) == 'boolean' then
                                        if node then
                                            node = 'true'
                                        else
                                            node = 'false'
                                        end
                                    elseif type(node) == 'string' then
                                        if node:len() > console.crop_string_at then node = node:sub(1, console.crop_string_at):gsub('\n', ' ') .. '...' end
                                    end
                                    text = text .. prefix .. ': ' .. console.value_bb .. node .. '[-]'
                                end
                            end
                        end
                    else
                        text = text .. "\nWatch list is empty."
                    end
                end
            else
                if not by_guid then
                    path = console.fill_path(path)
                end
                if clearing then
                    local node, id, parent, found
                    if not by_guid then
                        node, id, parent, found, path = console.node_from_path(path)
                    end
                    if console.watch_list[path] then
                        console.watch_list[path] = nil
                        if next(console.watch_list) == nil then
                            console.watch_list = nil
                        end
                        text = text .. '\n' .. console.header_bb.. 'No longer watching:[-] ' .. path
                    else
                        text = text .. '\n' .. console.error_bb .. '<not found>[-]'
                    end
                else
                    local node, id, parent, found
                    if by_guid then
                        node = getObjectFromGUID(path)
                        found = tostring(node) ~= 'null'
                    else
                        node, id, parent, found, path = console.node_from_path(path)
                    end
                    if node ~= nil and found then
                        if console.watch_list == nil then console.watch_list = {} end
                        if throttle == nil then throttle = 0 end
                        console.watch_list[path] = {player=player.color, throttle=throttle, last_check=0, property=property}
                        if type(node) == 'userdata' then
                            console.watch_list[path].position = node.getPosition()
                            console.watch_list[path].rotation = node.getRotation()
                            console.watch_list[path].is_guid  = by_guid
                        elseif type(node) == 'function' then
                            console.watch_list[path].parameters = parameters
                            console.watch_list[path].value = node
                            console.watch_list[path].label = console.function_bb .. path .. '[-]'
                            if property then
                                console.watch_list[path].label = console.watch_list[path].label .. console.seperator .. property
                            end
                            for _, label in ipairs(labels) do
                                console.watch_list[path].label = console.watch_list[path].label .. ' ' .. console.hidden_bb .. label .. '[-]'
                            end
                            console.watch_list[path].label = console.watch_list[path].label .. ': '
                        else
                            console.watch_list[path].value = node
                        end
                        if by_guid then
                            path = console.format_guid(path)
                        end
                        text = text .. '\n' .. console.header_bb .. 'Watching:[-] ' .. path
                    else
                        text = text .. '\n' .. console.error_bb .. '<not found>[-]'
                    end
                end
            end
            if text:len() > 1 and text:sub(1, 1) == '\n' then
                text = text:sub(2)
            end
            return text
        end
    )

    console.add_player_command('shout', '<text>',
        'Broadcast <text> to all players. Colour a section with {RRGGBB}section{-}.',
        function (player, ...)
            local text = player.steam_name .. ': '
            local space = ''
            for _, word in ipairs({...}) do
                text = text .. space .. tostring(word)
                space = ' '
            end
            text = text:gsub('{','[')
            text = text:gsub('}',']')
            broadcastToAll(text, stringColorToRGB(player.color))
            return nil, false
        end
    )

    -- change the command help color so client added commands appear different to console++
    console.set_command_listing_bb('[A0F0C0]')
end

end)
__bundle_register("Console/console", function(require, _LOADED, __bundle_register, __bundle_modules)
if not console then
    console = {}

    -- Change these values as you wish
    console.command_char = '>'
    console.option       = '-'
    console.prompt_color  = {r = 0.8,  g = 1.0,  b = 0.8 }
    console.command_color = {r = 0.8,  g = 0.6,  b = 0.8 }
    console.output_color  = {r = 0.88, g = 0.88, b = 0.88}
    console.invalid_color = {r = 1.0,  g = 0.2,  b = 0.2 }
    console.header_bb       = '[EECCAA]'
    console.error_bb        = '[FF9999]'
    console.inbuilt_help_bb = '[E0E0E0]'
    console.client_help_bb  = '[C0C0FF]'

    -- Exposed methods:

    function console.add_validation_function(validation_function)
        -- Adds a validation function all chat will be checked against:
        -- function(string message) which returns (boolean valid, string response)
        -- If all validation functions return <valid> as true the message will be displayed.
        -- If one returns <valid> as false then its <response> will be displayed to that player instead.
        table.insert(console.validation_functions, validation_function)
    end

    function console.add_player_command(command, parameter_text, help_text, command_function, default_parameters)
        -- Adds a command anyone can use, see below for details
        console.add_command(command, false, parameter_text, help_text, command_function, default_parameters)
    end

    function console.add_admin_command(command, parameter_text, help_text, command_function, default_parameters)
        -- Adds a command only admins can use, see below for details
        console.add_command(command, true, parameter_text, help_text, command_function, default_parameters)
    end

    function console.add_command(command, requires_admin, parameter_text, help_text, command_function, default_parameters)
        -- Adds a command to the console.
        -- command_function must take <player> as its first argument, and then any
        --   subsequent arguments you wish which will be provided by the player.
        -- You may alias an already-present command by calling this with command_function set to
        --   the command string instead of a function.  default_parameters can be set for the alias.
        -- See basic built-in commands at the bottom of this file for examples.
        local commands = console.commands
        local command_function = command_function
        local help_text = help_text
        local parameter_text = parameter_text
        if type(command_function) == 'string' then --alias
            if help_text == nil then
                help_text = commands[command_function].help_text
            end
            if parameter_text == nil then
                parameter_text = commands[command_function].parameter_text
            end
            command_function = commands[command_function].command_function
        end
        console.commands[command] = {
            command_function   = command_function,
            requires_admin     = requires_admin,
            parameter_text     = parameter_text,
            help_text          = help_text,
            help_bb            = console.command_help_bb,
            default_parameters = default_parameters,
        }
    end

    function console.set_command_listing_bb(bb)
        -- Tags commands added after with a bb color for when they are displayed (i.e. with 'help')
        console.command_help_bb = bb
    end

    function console.disable()
        -- Disables console for command purposes, but leaves validation functions running
        console.active = false
    end

    function console.enable()
        -- Enables console commands (console commands are on by default)
        console.active = true
    end

    -- End of exposed methods.  You shouldn't need to interact with anything below (under normal circumstances)


    console.active = true
    console.in_command_mode = {}
    console.commands = {}
    console.validation_functions = {}
    console.set_command_listing_bb(console.inbuilt_help_bb)

    function onChat(message, player)
        if message ~= '' then
            local command = ''
            local command_function = nil
            local parameters = {player}
            local requires_admin = false
            local command_mode = console.in_command_mode[player.steam_id]
            if command_mode and console.active then
                command, command_function, parameters, requires_admin = console.get_command(message, player)
            elseif message:sub(1, 1) == console.command_char and console.active then
                if message:len() > 1 then
                    command, command_function, parameters, requires_admin = console.get_command(message:sub(2), player)
                else
                    command, command_function, parameters, requires_admin = console.get_command(console.command_char, player)
                end
            else
                for i, f in ipairs(console.validation_functions) do
                    local valid, response = f(message)
                    if response == nil then response = '' end
                    if not valid then
                        printToColor(response, player.color, console.invalid_color)
                        return false
                    end
                end
                return true
            end
            if console.active then
                if command_function and (player.admin or not requires_admin) then
                    if command_mode then
                        message = console.command_char .. console.command_char .. message
                    end
                    local response, mute = command_function(unpack(parameters))
                    if response ~= nil or mute ~= nil then
                        if not mute then
                            printToColor('\n'..message, player.color, console.command_color)
                        end
                        if response then
                            printToColor(response, player.color, console.output_color)
                        end
                    end
                    if console.in_command_mode[player.steam_id] then console.display_prompt(player) end
                    return false
                else
                    printToColor('\n'..message, player.color, console.command_color)
                    printToColor(console.error_bb .. "<command '" .. command .. "' not found>[-]", player.color, console.output_color)
                    return false
                end
            end
        end
    end

    function console.get_command(message, player)
        local command_name = ''
        local command_function = nil
        local requires_admin = false
        local parameters = {player}
        for i, part in ipairs(console.split(message)) do
            if i == 1 then
                command_name = part
                local command = console.commands[command_name]
                if command then
                    command_function = command.command_function
                    requires_admin = command.requires_admin
                    if command.default_parameters then
                        for _, parameter in ipairs(command.default_parameters) do
                            table.insert(parameters, parameter)
                        end
                    end
                end
            else
                table.insert(parameters, part)
            end
        end
        return command_name, command_function, parameters, requires_admin
    end

    function console.display_prompt(player)
        printToColor(console.command_char..console.command_char, player.color, console.prompt_color)
    end

    function console.split(text, split_on)
        local split_on = split_on or ' '
        if type(split_on) == 'string' then
            local s = {}
            for c = 1, split_on:len() do
                s[split_on:sub(c,c)] = true
            end
            split_on = s
        end
        local parts = {}
        if text ~= '' then
            local make_table = function(s)
                local entries = console.split(s, ' ,')
                local t = {}
                for _, entry in ipairs(entries) do
                    if type(entry) == 'string' and entry:find('=') then
                        e = console.split(entry, '=')
                        t[e[1]] = e[2]
                    else
                        table.insert(t, entry)
                    end
                end
                return t
            end
            local current_split_on = split_on
            local adding = false
            local part = ""
            local totype = tonumber
            for c = 1, text:len() do
                local char = text:sub(c, c)
                if adding then
                    if current_split_on[char] then -- ended current part
                        if totype(part) ~= nil then
                            table.insert(parts, totype(part))
                        else
                            table.insert(parts, part)
                        end
                        adding = false
                        current_split_on = split_on
                        totype = tonumber
                    else
                        part = part .. char
                    end
                else
                    if not current_split_on[char] then -- found start of part
                        if char == "'" then
                            current_split_on = {["'"] = true}
                            totype = tostring
                            part = ''
                        elseif char == '"' then
                            current_split_on = {['"'] = true}
                            totype = tostring
                            part = ''
                        elseif char == '{' then
                            current_split_on = {['}'] = true}
                            totype = make_table
                            part = ''
                        else
                            part = char
                        end
                        adding = true
                    end
                end
            end
            if adding then
                if totype(part) ~= nil then
                    table.insert(parts, totype(part))
                else
                    table.insert(parts, part)
                end
            end
        end
        return parts
    end


    -- Add basic built-in console commands

    console.add_player_command('help', '[' .. console.option .. 'all|<command>]',
        'Display available commands or help on all commands or help on a specific command.',
        function (player, command)
            if command ~= nil then
                command = tostring(command)
            end
            local make_help = function (command)
                return console.header_bb .. command .. ' ' .. console.commands[command].parameter_text ..
                        '[-]\n' .. console.commands[command].help_text
            end
            local info_mode = false
            if command == console.option..'all' then
                info_mode = true
            end
            if command and console.commands[command] then
                return make_help(command)
            elseif command and not info_mode then
                return console.error_bb .. "<command '" .. command .. "' not found>[-]"
            else
                local msg = console.header_bb .. 'Available commands:[-]'
                local command_list = {}
                for c, _ in pairs(console.commands) do
                    if player.admin or not console.commands[c].requires_admin then
                        if info_mode then
                            table.insert(command_list, make_help(c))
                        else
                            table.insert(command_list, c)
                        end
                    end
                end
                table.sort(command_list)
                local sep
                if info_mode then
                    sep = '\n\n'
                else
                    sep = '\n'
                end
                for _, c in ipairs(command_list) do
                    local cmd = console.commands[c]
                    if cmd then
                        msg = msg .. sep .. cmd.help_bb .. c .. '[-]'
                    else
                        msg = msg .. sep .. c
                    end
                    if not info_mode then sep = ', ' end
                end
                return msg
            end
        end
    )
    console.add_player_command('?', nil, nil, 'help')
    console.add_player_command('info', '', 'Display help on all available commands.', 'help', {console.option..'all'})

    console.add_player_command('exit', '',
        "Leave <command mode> ('" .. console.command_char .. "' does the same).",
        function (player)
            console.in_command_mode[player.steam_id] = nil
            return console.header_bb .. '<command mode: off>[-]'
        end
    )

    console.add_player_command('cmd', '',
        "Enter <command mode> ('" .. console.command_char .. "' does the same).",
        function (player)
            console.in_command_mode[player.steam_id] = true
            return console.header_bb .. '<command mode: on>[-]'
        end
    )

    console.add_player_command(console.command_char, '',
        'Toggle <command mode>',
        function (player)
            console.in_command_mode[player.steam_id] = not console.in_command_mode[player.steam_id]
            if console.in_command_mode[player.steam_id] then
                return console.header_bb .. '<command mode: on>[-]', true
            else
                return console.header_bb .. '<command mode: off>[-]', true
            end
        end
    )

    console.add_player_command('=', '<expression>',
        'Evaluate an expression',
        function (player, ...)
            local expression = ''
            for _, arg in ipairs({...}) do
                expression = expression .. ' ' .. tostring(arg)
            end
            if not player.admin then
                expression = expression:gasub('[a-zA-Z~]', '')
            end
            console.returned_value = dynamic.eval(expression)
            return console.returned_value
        end
    )

    console.add_player_command('echo', '<text>',
        'Display text on screen',
        function (player, ...)
            local text = ''
            for _, arg in ipairs({...}) do
                text = text .. ' ' .. tostring(arg)
            end
            printToColor(text, player.color, console.output_color)
            return false
        end
    )

    console.add_player_command('cls', '',
        'Clear console text',
        function (player)
            return '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' ..
                   '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n'
        end
    )

    console.add_player_command('alias', '<alias> <command> [<parameter>...]',
        'Create a command alias.',
        function (player, ...)
            local alias
            local command
            local parameters = {}
            for i, arg in ipairs({...}) do
                if i == 1 then
                    alias = tostring(arg)
                elseif i == 2 then
                    command = tostring(arg)
                else
                    table.insert(parameters, arg)
                end
            end
            if not alias then
                return console.error_bb .. '<must provide an alias>[-]'
            --elseif console.commands[alias] ~= nil then
            --    return console.error_bb .. "<command '" .. alias .. "' already exists!>[-]"
            elseif command == nil then
                return console.error_bb .. "<must provide a command>[-]"
            elseif console.commands[command] == nil then
                return console.error_bb .. "<command '" .. command .. "' does not exist>[-]"
            else
                local text = console.header_bb .. alias .. '[-] = ' .. command
                local help_text = console.commands[command].help_text
                if not help_text:find('\nAliased to: ') then
                    help_text = help_text .. '\nAliased to: ' .. command
                end
                local combined_parameters = {}
                if console.commands[command].default_parameters then
                    for _, parameter in ipairs(console.commands[command].default_parameters) do
                        table.insert(combined_parameters, parameter)
                    end
                end
                for _, parameter in ipairs(parameters) do
                    table.insert(combined_parameters, parameter)
                    text = text .. ' ' .. parameter
                    help_text = help_text .. ' ' .. parameter
                end
                console.add_command(alias, console.commands[command].requires_admin, console.commands[command].parameter_text, help_text, command, combined_parameters)
                return text
            end
        end
    )

    -- change the command help color so client added commands appear different to in-built
    console.set_command_listing_bb(console.client_help_bb)
end

end)
return __bundle_require("Yellow Machine.46ccee.lua")