--[[ SCRIPTING FUNCTION DEFINITIONS ]]--


function none() end


function changeModelWoundCount(mod, target)
    local name = target.getName()
    local _,_, current, total = name:find("([0-9]+)/([0-9]+)")
    local colors,newName,currentBracket,updatedName,currentColor

    if current == nil then return end

    current = math.max(tonumber(current) + mod, 0)
    total = tonumber(total)
    newName = string.gsub(name, "([0-9]+)/([0-9]+)", current.."/"..total, 1)

    if current == 0 then
        currentColor = "[ff0000]"
    else
        local bracketData,bracketName,bracketProfileName

        if unitData.woundTrack ~= nil then
            if len(unitData.woundTrack) == 1 then
                for key,bracket in pairs(unitData.woundTrack) do
                    bracketData = bracket
                    bracketName = key
                end
            else
                -- not using hasTag because we don't know what tag to look for, only prefix
                for _,tag in pairs(target.getTags()) do
                    if tag:find("^wt:") ~= nil then
                        _,_,bracketName = tag:find("^wt:(.+)")
                        bracketData = unitData.woundTrack[bracketName]
                    end
                end
            end
        end

        local damagedCutoff = nil
        if unitData.edition == "10e" or unitData.edition == "11e" then
            for _,ability in ipairs(unitData.abilities) do
                if ability.name == "Core" then
                    -- Rosterizer version
                    damagedCutoff = string.match(ability.desc, "Damaged: %d+-(%d+)")
                    break
                elseif ability.name:find("^Damaged") ~= nil then
                    -- Battlescribe version
                    damagedCutoff = string.match(ability.name, "Damaged: %d+-(%d+)")
                    break
                end
            end
        end

        if damagedCutoff ~= nil then
            currentColor = current > tonumber(damagedCutoff) and "[00ff16]" or "[ff0000]"
        elseif bracketData == nil then
            colors = WOUND_COLOR_CUTOFFS[total]
            currentColor =  current > colors.g and "[00ff16]"
                            or (colors.o ~= nil and current > colors.o) and "[ffca00]" or "[ff0000]"
        else
            currentBracket = 1

            for key,_ in pairs(bracketData) do
                local cutoff,_ = key:gsub("(%d+)%-%d+%+?", "%1")
                if current >= tonumber(cutoff) then
                    bracketProfileName = bracketName.." ("..key..")"
                    break
                end

                currentBracket = currentBracket + 1
            end

            updateBracketCharacteristics(currentBracket, bracketData, bracketName, bracketProfileName, target)
            currentColor = WOUND_TRACK_COLORS[len(bracketData)][currentBracket]
        end
    end

    updatedName = string.gsub(newName, "^%[%w+]", currentColor, 1)

    target.setName(updatedName)
end

function updateBracketCharacteristics(bracket, bracketData, bracketName, bracketProfileName, target)
    local desc = target.getDescription()
    local updatedBracketCharacteristics,updatedHeadings = "","[56f442]"
    local bracketProfile,changingCharacteristics

    for _,profile in pairs(unitData.models) do
        if profile.name == bracketProfileName then bracketProfile = profile end
    end

    for heading,value in pairs(bracketProfile) do
        if heading ~= "name" and heading ~= "rowParity" then
            updatedBracketCharacteristics = updatedBracketCharacteristics..(isInList(heading, unitData.changingCharacteristics[bracketName])
                                and interpolate(BRACKET_VALUE, {
                                    color = BRACKET_VALUE_COLORS[len(bracketData)][bracket],
                                    val = value
                                })
                                or value).."   "

            updatedHeadings = updatedHeadings..formatHeading(heading, value)
        end
    end

    updatedBracketCharacteristics = updatedHeadings.."[-]\n"..updatedBracketCharacteristics.."[-][-]"

    target.setDescription(desc:gsub("%[56f442].-%[%-%]%[%-%]",updatedBracketCharacteristics))
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
    return s:gsub("^(%w)", function (a) return a:upper() end)
end


function showCrusadeCard(playerColor)
    loadCrusadeCard()
    -- delay to wait for update
    Wait.frames(function () showCard("crusadeCard", playerColor) end, 2)
end


function toggleRectangularMeasuring(playerColor, target)
    local isRectangular = target.hasTag("rectangularMeasuring")

    if not isRectangular then
        target.addTag("rectangularMeasuring")
        broadcastToAll("Model set to rectangular measuring")
    else
        target.removeTag("rectangularMeasuring")
        broadcastToAll("Model set to round measuring")
    end

    changeMeasurementCircle(0, target)
end








--[[ EVENT HANDLERS ]]--


function onLoad(savedState)
    if not self.hasTag("leaderModel") then return end -- prevents firing on objects we don't want firing

    local hasLoaded = self.getVar("hasLoaded")
    if hasLoaded == nil or not hasLoaded then
        local decodedState = savedState == nil and nil or JSON.decode(savedState)

        if decodedState ~= nil and loadDecodedState ~= nil then
            loadDecodedState(decodedState)
        elseif loadDefaultValues ~= nil then
            loadDefaultValues()
        end

        setContextMenuItemsForUnit()

        --Wait.frames(function () buildUI() end, 2)

        for _,model in ipairs(getObjectsWithTag("uuid:"..unitData.uuid)) do
            model.setVar("hasLoaded", true)
        end
    end
end


function onSave()
    if not self.hasTag("leaderModel") then return end -- prevents firing on objects we don't want firing
    if getCrusadeCardSaveData ~= nil then
        return JSON.encode(getCrusadeCardSaveData())
    end
end


function onScriptingButtonDown(index, playerColor)
    if not self.hasTag("leaderModel") then return end -- prevents firing on objects we don't want firing

    local player = Player[playerColor]
    local hoveredObject = player.getHoverObject()

    -- if the hovered object has a matching unitID, then it is part of this model's unit and thus is a valid target
    local isHoveringValidTarget = hoveredObject ~= nil and hoveredObject.hasTag("uuid:"..unitData.uuid)

    if isHoveringValidTarget then scriptingFunctions[index](playerColor, hoveredObject, player) end
end


function onObjectDrop(playerColor, droppedObject)
    if not self.hasTag("leaderModel") then return end -- prevents firing on objects we don't want firing
    if isCurrentlyCheckingCoherency and
        droppedObject ~= nil and
        unitData ~= nil and
        droppedObject.hasTag("uuid:"..unitData.uuid) then
            droppedObject.setLock(true)
            -- wait a frame for locking to cancel momentum
            Wait.frames(function ()
                droppedObject.setLock(false)
                highlightCoherency()
            end, 1)
    end
end


function onObjectRotate(object, spin, flip, playerColor, oldSpin, oldFlip)
    if not self.hasTag("leaderModel") then return end -- prevents firing on objects we don't want firing
    if isCurrentlyCheckingCoherency and
        flip ~= oldFlip and  -- update on model flip
        object.hasTag("uuid:"..unitData.uuid) then
        -- wait for a bit, otherwise the model will still be considered face down when its flipped face up and vice versa
        Wait.time(|| highlightCoherency(), 0.3)
    end
end


function onPlayerAction(player, action, targets)
    if not self.hasTag("leaderModel") then return end -- prevents firing on objects we don't want firing
    if action == Player.Action.Paste then
        local unitTag = "uuid:"..unitData.uuid
        for _,object in ipairs(targets) do
            if object.hasTag(unitTag) and object.hasTag("leaderModel") then
                object.setLuaScript("")
                object.removeTag("leaderModel")
            end
        end
    elseif action == Player.Action.Delete then
        local unitTag = "uuid:"..unitData.uuid
        for _,object in ipairs(targets) do
            if object == self then
                local modelsInUnit = getObjectsWithTag(unitTag)
                local modelsInUnitNotBeingDeleted = filter(modelsInUnit, |model| not includes(targets, model))
                if #modelsInUnitNotBeingDeleted > 1 then
                    local newLeader = modelsInUnitNotBeingDeleted[1]

                    updateEventHandlers(newLeader.getGUID())

                    Wait.frames(function ()
                        newLeader.setLuaScript(self.getLuaScript())
                        newLeader.UI.setXml(self.UI.getXml())
                        newLeader.addTag("leaderModel")
                    end, 2)

                    if loadCrusadeCard ~= nil then
                        Wait.frames(|| newLeader.call("loadCrusadeCard", crusadeCardData), 2)
                    end

                    self.removeTag("leaderModel")
                    --[[ local found = true

                    for _,model in ipairs(modelsInUnit) do
                        if model ~= self and not isInList(model, targets) then
                            found = false
                            break
                        end
                    end
                    -- if there are going to be any models left in the unit that arent this one,
                    -- prevent deletion
                    if not found then
                        broadcastToColor("Please don't delete me, I'm needed for scripting!", player.color, "Red")
                        return false
                    end --]]
                end
            end
        end
    end
end

function onObjectSpawn(object)
    if not self.hasTag("leaderModel") then return end -- prevents firing on objects we don't want firing

    if object ~= self and object.hasTag("leaderModel") and object.hasTag("uuid:"..unitData.uuid) then
        object.removeTag("leaderModel")
        object.setLuaScript("")
        --[[ local unitModels = getObjectsWithTag("uuid:"..unitData.uuid)

        for _,model in ipairs(unitModels) do
            if model ~= object and model.hasTag("leaderModel") then
                object.removeTag("leaderModel")
                object.setLuaScript("")
                break
            end
        end --]]
    end
end








--[[ UI UTILITY FUNCTIONS ]]--


function showCard(cardName, playerColor, doBeforeShowing, doAfterShowing)
    local timeToWait = 0

    if not hasBuiltUI then
        buildUI()
        hasBuiltUI = true
        timeToWait = 2
    end

    -- wait in case ui needs to update
    Wait.frames(function ()
        local globalUI = Global.UI.getXmlTable() or {}
        local selfUI = self.UI.getXmlTable() or {}
        local formattedCardName = "ymc-"..cardName.."-"..unitData.uuid.."-"..playerColor
        local shownYet = false

        -- yes, I know we go through the table twice, I don't like it
        for _,element in ipairs(globalUI) do
            if element ~= nil then
                recursivelyCleanElement(element)

                local attrs = element.attributes
                if attrs ~= nil and attrs.id == formattedCardName then
                    shownYet = true

                    if attrs.visibility ~= playerColor or not attrs.active then
                        attrs.visibility = playerColor
                        attrs.active = true
                    end
                end
            end
        end

        if not shownYet then
            local cardToShow = nil

            for _,root in ipairs(selfUI) do
                if root ~= nil and root.children ~= nil then
                    for _,child in ipairs(root.children) do
                        if child ~= nil and child.attributes ~= nil and child.attributes.id == cardName then
                            cardToShow = child
                            break
                        end
                    end
                end

                if cardToShow ~= nil then break end
            end

            if cardToShow == nil or cardToShow.attributes == nil then
                print("showCard: couldn't find UI card '"..tostring(cardName).."' for unit "..tostring(unitData.uuid))
                return
            end

            cardToShow.attributes.id = formattedCardName
            cardToShow.attributes.visibility = playerColor
            cardToShow.attributes.active = true

            recursivelyCleanElement(cardToShow)
            table.insert(globalUI, cardToShow)
        end

        Global.UI.setXmlTable(globalUI)
    end, timeToWait)
end


function hideCard(player, card)
    local playerColor = player.color

    if (player.color:find("^%w+$")) == nil then playerColor = "Grey" end

    local formattedCardName = "ymc-"..card.."-"..unitData.uuid.."-"..playerColor

    Global.UI.setAttribute(formattedCardName, "visibility", "None")
    Global.UI.setAttribute(formattedCardName, "active", false)

    Wait.time(function()
        local currentUI = UI.getXmlTable()
        local foundVisibleCard = false

        for _,element in ipairs(currentUI) do
            if element.attributes ~= nil and
                element.attributes.id ~= nil and
                (element.attributes.id:find("^ymc-")) ~= nil and -- if we find a card
                element.attributes.visibility ~= nil and
                element.attributes.visibility ~= "" and
                element.attributes.visibility ~= "None" then
                    foundVisibleCard = true
                    break
            end

            recursivelyCleanElement(element)
        end

        if not foundVisibleCard then return end

        currentUI = filter(currentUI, |element| element.attributes.id == nil or (element.attributes.id:find("^ymc-")) == nil)

        Global.UI.setXmlTable(currentUI)
    end, 0.11)
end

-- builds the XML string for the given section based on data defined in unitData (see top of file)
-- note: this is just for dataCard, although theoretically it can be used for any section

local function estimateRowHeight(desc, maxWidth, fontSize)
    desc = desc or ""

    -- slightly narrower average char width for proportional fonts
    local charWidth = fontSize * 0.50
    local charsPerLine = math.floor(maxWidth / charWidth)

    local lineHeight = fontSize * 1.2
    local baseHeight = fontSize * 2

    local totalLines = 0

    -- normalize line endings
    desc = desc:gsub("\r\n", "\n"):gsub("\r", "\n")

    -- split into lines
    local segments = {}
    for line in desc:gmatch("([^\n]*)\n?") do
        table.insert(segments, line)
    end

    -- remove trailing empty lines
    while #segments > 0 and segments[#segments] == "" do
        table.remove(segments)
    end

    for _, segment in ipairs(segments) do
        if segment == "" then
            -- blank line: treat as half a line
            totalLines = totalLines + 0.5
        else
            local segLength = #segment
            local wrapped = math.ceil(segLength / charsPerLine)
            totalLines = totalLines + wrapped
        end
    end

    return baseHeight + (totalLines * lineHeight)
end

local function normalizeAbilities(str)
    if not str or str == "-" then
        return ""
    end

    -- Force to string
    str = tostring(str)

    -- Replace newlines with commas (safe)
    str = str:gsub("[\r\n]+", ",")

    -- Remove ASCII control characters
    str = str:gsub("[%z\1-\31]", "")

    -- Remove high bytes (128–255)
    str = str:gsub("[\128-\255]", "")

    local list = {}
    local seen = {}

    -- ***************
    -- PATTERN‑FREE SPLIT
    -- ***************
    local start = 1
    local len = #str

    for i = 1, len + 1 do
        local c = str:sub(i, i)

        if c == "," or i == len + 1 then
            local ability = str:sub(start, i - 1)

            -- Trim whitespace (pattern‑free)
            ability = ability:gsub("^%s+", ""):gsub("%s+$", "")

            if ability ~= "" then
                local normalized = ability:gsub("%W", ""):upper()

                if normalized ~= "" and not seen[normalized] then
                    seen[normalized] = true
                    table.insert(list, ability)
                end
            end

            start = i + 1
        end
    end

    return "[" .. table.concat(list, ",") .. "]"
end

function buildXMLForSection(uiSection, dataSection)
    local uiString = ""     -- old: uiTemplates[section.."Header"]
    local rowParity = "#333333"
    for _,entry in pairs(unitData[dataSection]) do

        local rowHeight
        local template = uiTemplates[uiSection]

        if dataSection == "weapons" then
            entry.abilities = normalizeAbilities(entry.abilities)
        end

        -- Only calculate dynamic height for abilities
        if dataSection == "abilities" then
            rowHeight = estimateRowHeight(entry.desc, 800, 16)
            template = template:gsub('preferredHeight="%d+"', 'preferredHeight="' .. rowHeight .. '"')
            -- preserve newlines \n\n didn't work, this is ugly but its better than a wall of text.
            entry.desc = entry.desc:gsub("\r?\n%s*\r?\n", "<textcolor color='#00000000'>\n-\n</textcolor>")
            local success, result = pcall(function()
                entry.desc = entry.desc:gsub("%^%^(.-)%^%^", function(inner)
                    return inner:upper()
                end)
                entry.desc = entry.desc:gsub("%*%*(.-)%*%*", "<b>%1</b>")
            end)
            if not success then
                -- Best-effort: if pattern fails, leave desc as-is
            end
        else
            -- fallback: read height from template
            _,_,rowHeight = template.find(uiTemplates[uiSection], 'Row.-preferredHeight="(%d+)"')
        end

        entry["rowParity"] = rowParity
        uiString = uiString..interpolate(template, entry)
        dataCardHeight = dataCardHeight + tonumber(rowHeight)
        rowParity = rowParity == "#333333" and "#212121" or "#333333"
    end
    self.UI.setValue(uiSection, uiString)
end

function buildUI()
    self.UI.setAttribute("ym-container", "unit-id", unitData.uuid)

    self.UI.setAttribute("dataCard", "height", unitData.uiHeight)
    self.UI.setAttribute("dataCard", "width", unitData.uiWidth)

    self.UI.setValue("data-unitName", unitData.unitName)
    self.UI.setValue("factionKeywords", unitData.factionKeywords)
    self.UI.setValue("keywords", unitData.keywords)

    if unitData.edition == "11e" then
        self.UI.setAttribute("modelsTable9e", "active", false)
        self.UI.setAttribute("modelsTable10e", "active", false)
        self.UI.setAttribute("modelsTable11e", "active", true)
        buildXMLForSection("models11e", "models")

        self.UI.setAttribute("weaponsTable9e", "active", false)
        self.UI.setAttribute("weaponsTable10e11e", "active", true)
        buildXMLForSection("weapons10e11e", "weapons")
    elseif unitData.edition == "10e" then
        self.UI.setAttribute("modelsTable9e", "active", false)
        self.UI.setAttribute("modelsTable10e", "active", true)
        self.UI.setAttribute("modelsTable11e", "active", false)
        buildXMLForSection("models10e", "models")

        self.UI.setAttribute("weaponsTable9e", "active", false)
        self.UI.setAttribute("weaponsTable10e11e", "active", true)
        buildXMLForSection("weapons10e11e", "weapons")
    else
        self.UI.setAttribute("modelsTable9e", "active", true)
        self.UI.setAttribute("modelsTable10e", "active", false)
        self.UI.setAttribute("modelsTable11e", "active", false)
        buildXMLForSection("models9e", "models")

        self.UI.setAttribute("weaponsTable9e", "active", true)
        self.UI.setAttribute("weaponsTable10e11e", "active", false)
        buildXMLForSection("weapons9e", "weapons")
    end

    buildXMLForSection("abilities", "abilities")

    if unitData.psykerProfiles ~= nil then
        buildXMLForSection("powersKnown", "powersKnown")
        buildXMLForSection("psykerProfiles", "psykerProfiles")

        self.UI.setAttribute("powersKnownContainer", "active", true)
        self.UI.setAttribute("psykerProfilesContainer", "active", true)

        dataCardHeight = dataCardHeight + 140 -- add space for two headers (40px each) and two spaces (30px each)
    end

    local guid = self.getGUID()

    self.UI.setAttribute("dataCardCloseButton", "onClick", guid.."/hideCard(dataCard)")
    self.UI.setValue("highlightButtonsContainer", interpolate(uiTemplates.buttons, { guid=guid, width=(unitData.uiWidth/10)-4 }))

    self.UI.setAttribute("dataCardContentContainer", "height", dataCardHeight)

    if buildCrusadeUI ~= nil then buildCrusadeUI(guid) end
end

function setContextMenuItemsForUnit()
    local hasLoaded = self.getVar("hasLoaded")
    if hasLoaded == nil or not hasLoaded then
        local unit = getObjectsWithTag("uuid:"..unitData.uuid)

        if not unitData.isSingleModel and #unit > 1 then
            for _,model in ipairs(unit) do
                model.addContextMenuItem("Toggle Coherency ✓", toggleCoherencyChecking)
            end
        end
    end
end

function updateEventHandlers(guid)
    self.UI.setAttribute("dataCardCloseButton", "onClick", guid.."/hideCard(dataCard)")
    Global.UI.setAttribute("dataCardCloseButton", "onClick", guid.."/hideCard(dataCard)")
    self.UI.setValue("highlightButtonsContainer", interpolate(uiTemplates.buttons, { guid=guid, width=(unitData.uiWidth/10)-4 }))
end











--[[ HIGHLIGHTING FUNCTIONS ]]--


function highlightUnit(player, color)
    for _,model in pairs(getObjectsWithTag("uuid:"..unitData.uuid)) do
        model.highlightOn(color)
        model.setVar("currentHighlightColor", color)
    end
end

function unhighlightUnit()
    for _,model in pairs(getObjectsWithTag("uuid:"..unitData.uuid)) do
        model.highlightOff()
        model.setVar("currentHighlightColor", nil)
    end
end






--[[ UNIT COHERENCY FUNCTIONS ]]--

function toggleCoherencyChecking(playerColor)
    isCurrentlyCheckingCoherency = not isCurrentlyCheckingCoherency

    if isCurrentlyCheckingCoherency then
        highlightCoherency()
        broadcastToColor("Checking coherency for "..unitData.unitDecorativeName, playerColor, playerColor)
    else
        local oldHighlight = self.getVar("currentHighlightColor")

        if oldHighlight == nil then
            unhighlightUnit()
        else
            highlightUnit(nil, oldHighlight)
        end

        broadcastToColor("No longer checking coherency for "..unitData.unitDecorativeName, playerColor, playerColor)
    end
end

function highlightCoherency()
    local modelsInUnit = getObjectsWithTag("uuid:"..unitData.uuid)
    local filteredUnits = {}

    for _,model in ipairs(modelsInUnit) do
        if model.is_face_down then -- ignore face-down models
            model.highlightOff()
        else
            table.insert(filteredUnits, model)
        end
    end

    local coherencyCheckNum = (#filteredUnits > 5) and 2 or 1
    local coherencyGroups = getCoherencyGroups(filteredUnits, coherencyCheckNum)
    local numberOfBlobs = len(coherencyGroups)

    if numberOfBlobs == 0 then return
    elseif numberOfBlobs > 1 then
        for _,blob in ipairs(coherencyGroups) do
            for modelIdx,_ in pairs(blob) do
                filteredUnits[modelIdx].highlightOff()
                filteredUnits[modelIdx].highlightOn("Yellow")
            end
        end
    else
        -- don't just highlight all the models in the unit, there might be other models
        -- that were purely outside of coherency (and thus not in a blob)
        for modelIdx,_ in pairs(coherencyGroups[1]) do
            filteredUnits[modelIdx].highlightOff()
            filteredUnits[modelIdx].highlightOn("Green")
        end
    end
end

function getCoherencyGroups(modelsToSearch, numberToLookFor)
    local edges = getCoherencyGraph(modelsToSearch)
    local blobs = {}
    local modelsToIgnore = {}

    for idx,model in ipairs(modelsToSearch) do
        if edges[idx] == nil or #edges[idx] < numberToLookFor then -- the model is out of coherency
            model.highlightOff()
            model.highlightOn("Red")

            modelsToIgnore[idx] = true
            -- remove from any blobs the model is already in
            for _,blob in ipairs(blobs) do
                blob[idx] = nil
            end
        else
            local found = false
            -- see if this index exists in a blob, if it does, ignore it
            for _,blob in ipairs(blobs) do
                if blob[idx] == true then
                    found = true
                    break
                end
            end

            if not found then
                local newBlob = {}

                table.insert(blobs, newBlob)
                addModelsToBlobRecursive(idx, newBlob, edges, modelsToIgnore)
            end
        end
    end

    return blobs
end

function getCoherencyGraph(modelsToSearch)
    local edges = {}

    for idx=1,#modelsToSearch do
        for otherIdx=idx+1,#modelsToSearch do
            local firstPosition = modelsToSearch[idx].getPosition()
            local firstSize = determineBaseInInches(modelsToSearch[idx])
            local secondPosition = modelsToSearch[otherIdx].getPosition()
            local secondSize = determineBaseInInches(modelsToSearch[otherIdx])
            local verticalDisplacement = distanceBetweenVertical(firstPosition, secondPosition)

            -- handle circular bases
            if firstSize.x == firstSize.z and secondSize.x == secondSize.z then
                if distanceBetween2D(firstPosition, firstSize.x, secondPosition, secondSize.x) <= 2 and
                    verticalDisplacement <= 5 then
                    -- store all edges of a graph where models are nodes and edges represent coherency
                    storeEdges(edges, idx, otherIdx)
                end
            else -- handle non-circular bases
                if firstSize.x ~= firstSize.z and secondSize.x ~= secondSize.z then -- handle two ovals
                    -- if the bases were circles with radiuses = minor axes and they are in coherency,
                    -- the ovals must be in coherency
                    if distanceBetween2D(firstPosition, math.min(firstSize.x, firstSize.z), secondPosition, math.min(secondSize.x, secondSize.z)) <= 2 and
                        verticalDisplacement <= 5 then
                        -- store edges in graph
                        storeEdges(edges, idx, otherIdx)

                    -- if the bases were circles with radiuses = major axes and they are out of coherency,
                    -- there is no way for the ovals to be in coherency
                    elseif not (distanceBetween2D(firstPosition, math.max(firstSize.x, firstSize.z), secondPosition, math.max(secondSize.x, secondSize.z)) > 2 or
                                verticalDisplacement > 5) then
                        -- only way to get here is if coherency is uncertain, so now check a little more precisely (only a little)
                        if distanceBetween2D(firstPosition, (firstSize.x+firstSize.z)/2, secondPosition, (secondSize.x+secondSize.z)/2) <= 2 and
                            verticalDisplacement <= 5 then
                            storeEdges(edges, idx, otherIdx)
                        end
                    end
                else -- handle one circle and one oval
                    local oval,ovalPosition,circle,circlePosition

                    if firstSize.x ~= firstSize.z then
                        oval = firstSize
                        ovalPosition = firstPosition
                        circle = secondSize
                        circlePosition = secondPosition
                    else
                        oval = secondSize
                        ovalPosition = secondPosition
                        circle = firstSize
                        circlePosition = firstPosition
                    end

                    -- if the oval base was a circle with radius = minor axis and they are in coherency,
                    -- the models must be in coherency
                    if distanceBetween2D(circlePosition, circle.x, ovalPosition, math.min(oval.x, oval.z)) <= 2 and
                        verticalDisplacement <= 5 then
                        storeEdges(edges, idx, otherIdx)

                    -- if the oval base was a circle with radius = major axis and they are out of coherency,
                    -- there is no way for the models to be in coherency
                    elseif not (distanceBetween2D(circlePosition, circle.x, ovalPosition, math.max(oval.x, oval.z)) > 2 or
                                verticalDisplacement > 5) then
                        -- only way to get here is if coherency is uncertain, so now check a little more precisely (only a little)
                        if distanceBetween2D(circlePosition, circle.x, ovalPosition, (oval.x+oval.z)/2) <= 2 and
                            verticalDisplacement <= 5 then
                            storeEdges(edges, idx, otherIdx)
                        end
                    end
                end
            end
        end
    end

    return edges
end

function storeEdges(edges, idx, otherIdx)
    if edges[idx] == nil then edges[idx] = { otherIdx }
    else table.insert(edges[idx], otherIdx) end

    if edges[otherIdx] == nil then edges[otherIdx] = { idx }
    else table.insert(edges[otherIdx], idx) end
end

function addModelsToBlobRecursive(idx, blob, edges, modelsToIgnore)
    -- at this point, idx should not exist in any blobs
    if modelsToIgnore[idx] ~= nil then return end
    if blob[idx] ~= nil then return end

    blob[idx] = true

    for _,edge in ipairs(edges[idx]) do
        addModelsToBlobRecursive(edge, blob, edges, modelsToIgnore)
    end
end








--[[ UTILITY FUNCTIONS ]]--

-- Replacement for previous gsub-based version due to suspected
-- MoonSharp regression.
function interpolate(templateString, replacementValues)
    if templateString == nil then return "" end
    if replacementValues == nil then return templateString end

    local out = {}
    local idx = 1
    local templateLen = #templateString

    while idx <= templateLen do
        local startIdx = templateString:find("${", idx, true)

        if startIdx == nil then
            table.insert(out, templateString:sub(idx))
            break
        end

        if startIdx > idx then
            table.insert(out, templateString:sub(idx, startIdx - 1))
        end

        local endIdx = templateString:find("}", startIdx + 2, true)

        if endIdx == nil then
            table.insert(out, templateString:sub(startIdx))
            break
        end

        local key = templateString:sub(startIdx + 2, endIdx - 1)
        local replacement = replacementValues[key]

        -- Preserve old behavior: false/nil leave the token untouched.
        if replacement == nil or replacement == false then
            table.insert(out, templateString:sub(startIdx, endIdx))
        else
            table.insert(out, tostring(replacement))
        end

        idx = endIdx + 1
    end

    return table.concat(out)
end


function isInList(key, list)
    for _,k in pairs(list) do
        if k == key then return true end
    end
    return false
end

function len(t)
    local count = 0

    for _,_ in pairs(t) do
        count = count + 1
    end

    return count
end

function distanceBetween2D(firstModelPosition, firstModelRadius, secondModelPosition, secondModelRadius)
    -- generally should only be checking coherency with circular bases?
    return getRawDistance(firstModelPosition.x, firstModelPosition.z,
                secondModelPosition.x, secondModelPosition.z) - firstModelRadius - secondModelRadius
end

function distanceBetweenVertical(firstModelPosition, secondModelPosition)
    -- vertical measuring assumes the model has a base because generally vehicles (or models without bases)
    -- dont need to check coherency, and the ones that do probably wont be out of vertical coherency
    -- because they cant end up on upper floors of buildings or walls
    return math.abs(firstModelPosition.y - secondModelPosition.y) - 0.2 -- this is assuming the model has a base
end

function getRawDistance(firstA, firstB, secondA, secondB)
    return math.sqrt(
        math.pow(firstA - secondA, 2) +
        math.pow(firstB - secondB, 2)
    )
end

function includes(tab, val)
    return find(tab, val) > 0
end

function find(tab, val)
    for index, value in ipairs(tab) do
        if value == val then
            return index
        end
    end

    return -1
end

function filter(t, filterFunc)
    local out = {}

    for k, v in pairs(t) do
      if filterFunc(v, k, t) then table.insert(out,v) end
    end

    return out
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

function map(t, mapFunc)
    local out = {}

    for k,v in pairs(clone(t)) do
        table.insert(out, mapFunc(v,k))
    end

    return out
end

function recursivelyCleanElement(element)
    if element.value ~= nil then
        element.value = element.value:gsub("[ ]+"," ") -- remove extraneous spaces
    end

    if element.children ~= nil and #element.children > 0 then
        for _,child in ipairs(element.children) do
            recursivelyCleanElement(child)
        end
    end
end


function getUnitData() -- allow external TTS mods to access yellowscribe information
    return unitData
end






--[[ MEASURING CIRCLE FUNCTIONS ]]--


function assignBase(inc, target)
    local savedBase = target.getTable("chosenBase")

    if savedBase == nil then
        changeMeasurementCircle(0, target, determineBaseInInches(target))
    else
        local newIdx = savedBase.baseIdx + inc

        if newIdx < 1 then newIdx = #VALID_BASE_SIZES_IN_MM end
        if newIdx > #VALID_BASE_SIZES_IN_MM then newIdx = 1 end

        local newBase = {
            baseIdx = newIdx,
            base = {
                x = (VALID_BASE_SIZES_IN_MM[newIdx].x * MM_TO_INCH)/2,
                z = (VALID_BASE_SIZES_IN_MM[newIdx].z * MM_TO_INCH)/2
            }
        }

        target.setTable("chosenBase", newBase)

        changeMeasurementCircle(0, target, newBase.base)
    end
end


function determineBaseInInches(model)
    local savedBase = model.getTable("chosenBase")

    if savedBase ~= nil then
        return savedBase.base
    else
        local chosenBase =  VALID_BASE_SIZES_IN_MM[1]
        local modelSize = model.getBoundsNormalized().size
        local modelSizeX = modelSize.x
        local modelSizeZ = modelSize.z
        local closestSum = 10000000000
        local chosenBaseIdx = 1

        for k, base in pairs(VALID_BASE_SIZES_IN_MM) do
            local baseInchX = (MM_TO_INCH - 0.001) * base.x
            local baseInchZ = (MM_TO_INCH - 0.001) * base.z
            if modelSizeX > baseInchX and modelSizeZ > baseInchZ then
                local distSum = (modelSizeX - baseInchX) + (modelSizeZ - baseInchZ)
                if distSum < closestSum then
                    closestSum = distSum
                    chosenBase = base
                    chosenBaseIdx = k
                end
            end
        end

        if chosenBase == nil then
            chosenBase = { x=modelSizeX/2, z=modelSizeZ/2}
        else
            chosenBase = {
                x = (chosenBase.x * MM_TO_INCH)/2,
                z = (chosenBase.z * MM_TO_INCH)/2
            }
        end

        model.setTable("chosenBase", { baseIdx=chosenBaseIdx, base=chosenBase })

        return chosenBase
    end
end


function changeMeasurementCircle(change, target, presetBase)
    local measuringRings = target.getTable("ym-measuring-circles")
    local currentColor = target.getVar("currentHighlightColor")
    local currentColorRadius

    if measuringRings == nil then
        measuringRings = {}
        currentColorRadius = 0
    else
        for idx=#measuringRings,1,-1 do
            if (measuringRings[idx].name == currentColor) or (measuringRings[idx].name == nil and currentColor == nil) then
                currentColorRadius = measuringRings[idx].radius
                table.remove(measuringRings, idx)
            elseif measuringRings[idx].name == "base" then
                table.remove(measuringRings, idx)
            end
        end

        if currentColorRadius == nil then currentColorRadius = 0 end
    end

    local newRadius = math.max(currentColorRadius + change, 0)

    if newRadius == 0 then

    else

        local isRectangular = target.hasTag("rectangularMeasuring")
        local measuring = {
            name = currentColor,
            color = currentColor == nil and {1,0,1} or Color.fromString(currentColor),
            radius = newRadius,
            thickness = 0.1 * 1/(target.getScale().x),
            rotation  = {270,0,0}--isRectangular and {0,0,0} or {270,0,0}
        }
        local base = {
            name="base",
            color = currentColor == nil and {1,0,1} or Color.fromString(currentColor),
            thickness = 0.1 * 1/(target.getScale().x),
            rotation  = {270,0,0}--isRectangular and {0,0,0} or {270,0,0}
        }
        local measuringPoints,basePoints

        if isRectangular then
            local modelBounds = target.getBoundsNormalized()

            if newRadius > 0 then
                measuringPoints = getRectangleVectorPoints(newRadius, modelBounds.size.x/2, modelBounds.size.z/2, target)
                basePoints = getRectangleVectorPoints(0, modelBounds.size.x/2, modelBounds.size.z/2, target)
            end
        else
            local baseRadiuses = (presetBase == nil) and determineBaseInInches(target) or presetBase

            if newRadius > 0 then
                measuringPoints = getCircleVectorPoints(newRadius, baseRadiuses.x, baseRadiuses.z, target)
                basePoints = getCircleVectorPoints(0, baseRadiuses.x, baseRadiuses.z, target)
            end
        end

        measuring.points = measuringPoints
        base.points = basePoints

        table.insert(measuringRings, measuring)
        table.insert(measuringRings, base)

        broadcastToAll("Measuring "..tostring(newRadius).."\"")
    end

    target.setVectorLines(measuringRings)

    target.setTable("ym-measuring-circles", measuringRings)
end


function getCircleVectorPoints(radius, baseX, baseZ, obj)
    local result = {}
    local scaleFactor = 1/obj.getScale().x
    local rotationDegrees =  obj.getRotation().y
    local steps = 64
    local degrees,sin,cos,toRads = 360/steps, math.sin, math.cos, math.rad

    for i = 0,steps do
        table.insert(result,{
            x = cos(toRads(degrees*i))*((radius+baseX)*scaleFactor),
            z = MEASURING_RING_Y_OFFSET,
            y = sin(toRads(degrees*i))*((radius+baseZ)*scaleFactor)
        })
    end

    return result
end


function getRectangleVectorPoints(radius, sizeX, sizeZ, obj)
    local result = {}
    local scaleFactor = 1/obj.getScale().x

    sizeX = sizeX*scaleFactor
    sizeZ = sizeZ*scaleFactor
    radius = radius*scaleFactor

    local steps = 65
    local degrees,sin,cos,toRads = 360/(steps-1), math.sin, math.cos, math.rad
    local xOffset,zOffset = sizeX,sizeZ
    -- compensate for ignoring vertical line
    table.insert(result,{
        x = (cos(toRads(degrees*0))*radius)+sizeX-0.001,
        y = (sin(toRads(degrees*0))*radius)+sizeZ,
        z = MEASURING_RING_Y_OFFSET
    })

    for i = 1,steps-1 do
        if i == 16 then
            table.insert(result,{ x= sizeX, y=(radius+sizeZ), z=MEASURING_RING_Y_OFFSET })
            table.insert(result,{ x=-sizeX, y=(radius+sizeZ), z=MEASURING_RING_Y_OFFSET })
            xOffset = -sizeX
        elseif i == 33 then
            table.insert(result,{ x=-radius-sizeX,       y= sizeZ, z=MEASURING_RING_Y_OFFSET })
            table.insert(result,{ x=-radius-sizeX-0.001, y=-sizeZ, z=MEASURING_RING_Y_OFFSET })
            table.insert(result,{ x=-radius-sizeX,       y=-sizeZ, z=MEASURING_RING_Y_OFFSET })
            zOffset = -sizeZ
        elseif i == 49 then
            table.insert(result,{ x=-sizeX, y=-radius-sizeZ, z=MEASURING_RING_Y_OFFSET })
            table.insert(result,{ x= sizeX, y=-radius-sizeZ, z=MEASURING_RING_Y_OFFSET })
            xOffset = sizeX
        elseif i == 65 then
            table.insert(result,{ x=radius+sizeX,       y=-sizeZ, z=MEASURING_RING_Y_OFFSET })
            table.insert(result,{ x=radius+sizeX-0.001, y= sizeZ, z=MEASURING_RING_Y_OFFSET })
        else
            table.insert(result,{
                x = (cos(toRads(degrees*i))*radius)+xOffset,
                y = (sin(toRads(degrees*i))*radius)+zOffset,
                z = MEASURING_RING_Y_OFFSET
            })
        end
    end
    -- compensate for ignoring vertical line
    table.insert(result,{
        x = (cos(toRads(degrees*0))*radius)+sizeX-0.001,
        y = (sin(toRads(degrees*0))*radius)+sizeZ,
        z = MEASURING_RING_Y_OFFSET
    })

    return result
end
