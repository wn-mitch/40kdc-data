<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<gameSystem xmlns="http://www.battlescribe.net/schema/gameSystemSchema" name="Warhammer 40,000 11th Edition" id="sys-352e-adc2-7639-d610" battleScribeVersion="2.03" revision="10502">
  <readme>Generated from @alpaca-software/40kdc-data 1.5.2. Stat lines and points are numerical facts; ability descriptions are 40kdc's own plain-English summaries, not rules text.</readme>
  <publications>
    <publication name="40kdc-data" id="8d11-51b0-f376-c893" publisherUrl="https://40kdc.alpacasoft.dev"/>
  </publications>
  <costTypes>
    <costType name="pts" id="51b2-306e-1021-d207" defaultCostLimit="-1" hidden="false"/>
    <costType name="Detachment Points" id="82ae-1066-5107-6ae0" defaultCostLimit="-1" hidden="false"/>
    <costType name="Enhancements" id="f759-1bc4-cb3a-f0d2" defaultCostLimit="-1" hidden="true"/>
  </costTypes>
  <profileTypes>
    <profileType name="Unit" id="c547-1836-d8a-ff4f">
      <characteristicTypes>
        <characteristicType name="M" id="e703-ecb6-5ce7-aec1"/>
        <characteristicType name="T" id="d29d-cf75-fc2d-34a4"/>
        <characteristicType name="Sv" id="450-a17e-9d5e-29da"/>
        <characteristicType name="W" id="750a-a2ec-90d3-21fe"/>
        <characteristicType name="LD" id="58d2-b879-49c7-43bc"/>
        <characteristicType name="OC" id="bef7-942a-1a23-59f8"/>
        <characteristicType name="InSv" id="55a7-5b54-c60d-11dc"/>
        <characteristicType name="Base" id="nr-base-size"/>
      </characteristicTypes>
    </profileType>
    <profileType name="Ranged Weapons" id="f77d-b953-8fa4-b762">
      <characteristicTypes>
        <characteristicType name="Range" id="9896-9419-16a1-92fc"/>
        <characteristicType name="A" id="3bb-c35f-f54-fb08"/>
        <characteristicType name="BS" id="94d-8a98-cf90-183e"/>
        <characteristicType name="S" id="2229-f494-25db-c5d3"/>
        <characteristicType name="AP" id="9ead-8a10-520-de15"/>
        <characteristicType name="D" id="a354-c1c8-a745-f9e3"/>
        <characteristicType name="Keywords" id="7f1b-8591-2fcf-d01c"/>
      </characteristicTypes>
    </profileType>
    <profileType name="Melee Weapons" id="8a40-4aaa-c780-9046">
      <characteristicTypes>
        <characteristicType name="Range" id="914c-b413-91e3-a132"/>
        <characteristicType name="A" id="2337-daa1-6682-b110"/>
        <characteristicType name="WS" id="95d1-95f-45b4-11d6"/>
        <characteristicType name="S" id="ab33-d393-96ce-ccba"/>
        <characteristicType name="AP" id="41a0-1301-112a-e2f2"/>
        <characteristicType name="D" id="3254-9fe6-d824-513e"/>
        <characteristicType name="Keywords" id="893f-9000-ccf7-648e"/>
      </characteristicTypes>
    </profileType>
    <profileType name="Abilities" id="9cc3-6d83-4dd3-9b64">
      <characteristicTypes>
        <characteristicType name="Description" id="9b8f-694b-e5e-b573"/>
      </characteristicTypes>
    </profileType>
    <profileType name="Transport" id="74f8-5443-9d6d-1f1e">
      <characteristicTypes>
        <characteristicType name="Capacity" id="30f2-be70-861d-1b84"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <categoryEntries>
    <categoryEntry name="Configuration" id="4ac9-fd30-1e3d-b249" hidden="false"/>
    <categoryEntry name="Epic Hero" id="4f3a-f0f7-6647-348d" hidden="false"/>
    <categoryEntry name="Character" id="9cfd-1c32-585f-7d5c" hidden="false"/>
    <categoryEntry name="Battleline" id="e338-111e-d0c6-b687" hidden="false"/>
    <categoryEntry name="Infantry" id="cf47-a0d7-7207-29dc" hidden="false"/>
    <categoryEntry name="Swarm" id="b00b-5bae-444f-964e" hidden="false"/>
    <categoryEntry name="Mounted" id="14a0-40c9-2748-ae6e" hidden="false"/>
    <categoryEntry name="Beast" id="4c3e-9310-a516-3590" hidden="false"/>
    <categoryEntry name="Monster" id="9693-cf84-fe69-37a9" hidden="false"/>
    <categoryEntry name="Vehicle" id="dbd4-63-af05-998" hidden="false"/>
    <categoryEntry name="Drone" id="2471-e2e0-3f55-d6cb" hidden="false"/>
    <categoryEntry name="Dedicated Transport" id="ba07-411c-2832-1f79" hidden="false"/>
    <categoryEntry name="Fortification" id="19d7-9c74-2140-5851" hidden="false"/>
    <categoryEntry name="Unit" id="1160-70ae-a862-b1a8" hidden="false"/>
    <categoryEntry name="Leader" id="1556-9b56-fba6-4370" hidden="true"/>
    <categoryEntry name="Support" id="7dcd-7f61-69a7-0294" hidden="true"/>
    <categoryEntry name="Warlord" id="5c0e-4c31-d51b-e470" hidden="false">
      <constraints>
        <constraint id="6774-6c4d-fe7d-d1ff" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="min" value="1"/>
        <constraint id="c73e-6956-78a4-8e24" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="max" value="1"/>
      </constraints>
    </categoryEntry>
    <categoryEntry name="3DP Detachment" id="7d80-2de5-816e-9d2b" hidden="true">
      <constraints>
        <constraint id="aceb-f4ed-64d4-3e44" field="selections" includeChildSelections="true" scope="force" shared="true" type="max" value="1"/>
      </constraints>
    </categoryEntry>
    <categoryEntry name="Supreme Commander" id="75fe-c657-43c6-7c09" hidden="true"/>
    <categoryEntry name="Take and Hold" id="1cc1-f11a-4e8f-1bcc" hidden="false"/>
    <categoryEntry name="Disruption" id="ecf8-cf72-7d5b-1b5b" hidden="false"/>
    <categoryEntry name="Purge the Foe" id="6fe0-3dbe-f7e0-10bb" hidden="false"/>
    <categoryEntry name="Priority Assets" id="0936-9767-1cc7-52ae" hidden="false"/>
    <categoryEntry name="Reconnaissance" id="b4a7-5083-fe94-4d24" hidden="false"/>
    <categoryEntry name="Faction: Adepta Sororitas" id="fd71-afa6-b13b-7fda" hidden="false"/>
    <categoryEntry name="Faction: Adeptus Astartes" id="6e7-40c-58d9-e402" hidden="false"/>
    <categoryEntry name="Faction: Adeptus Custodes" id="eea5-aeaf-bbf0-d5ee" hidden="false"/>
    <categoryEntry name="Faction: Adeptus Mechanicus" id="5418-f86b-6e76-c5a" hidden="false"/>
    <categoryEntry name="Faction: Adeptus Titanicus" id="ce65-9688-1675-039b" hidden="false"/>
    <categoryEntry name="Faction: Aeldari" id="8528-2c45-4818-8ae3" hidden="false"/>
    <categoryEntry name="Faction: Agents of the Imperium" id="5128-90b-e4a5-dcbd" hidden="false"/>
    <categoryEntry name="Faction: Anathema Psykana" id="7657-9489-dcab-2da7" hidden="false"/>
    <categoryEntry name="Faction: Astra Militarum" id="fa45-57e-930e-602b" hidden="false"/>
    <categoryEntry name="Faction: Asuryani" id="4378-1827-4988-be4e" hidden="false"/>
    <categoryEntry name="Faction: Black Templars" id="9249-acae-2882-d95" hidden="false"/>
    <categoryEntry name="Faction: Blood Angels" id="62ac-ef42-27b4-ae7" hidden="false"/>
    <categoryEntry name="Faction: Blood Legions" id="59ae-0891-ec10-e996" hidden="false"/>
    <categoryEntry name="Faction: Chaos" id="7700-c5b2-1cc3-a933" hidden="false"/>
    <categoryEntry name="Faction: Chaos Knights" id="bb67-f191-6562-acc7" hidden="false"/>
    <categoryEntry name="Faction: Daemons" id="6fdc-427e-4ebd-a34f" hidden="false"/>
    <categoryEntry name="Faction: Dark Angels" id="aab1-4f05-fabe-5ba5" hidden="false"/>
    <categoryEntry name="Faction: Death Guard" id="9888-ddb2-a141-6037" hidden="false"/>
    <categoryEntry name="Faction: Deathwatch" id="d39c-9989-db7f-d815" hidden="false"/>
    <categoryEntry name="Faction: Drukhari" id="1015-db48-a2fa-c7da" hidden="false"/>
    <categoryEntry name="Faction: Emperor's Children" id="4f6c-e4fc-85c3-6af5" hidden="false"/>
    <categoryEntry name="Faction: Genestealer Cults" id="226b-cf1e-353a-ae7f" hidden="false"/>
    <categoryEntry name="Faction: Grey Knights" id="d564-3284-bf44-b873" hidden="false"/>
    <categoryEntry name="Faction: Harlequins" id="a5a2-d0c0-0349-d226" hidden="false"/>
    <categoryEntry name="Faction: Heretic Astartes" id="1e42-dfae-cbdd-207d" hidden="false"/>
    <categoryEntry name="Faction: Imperial Fists" id="97aa-d0e4-71c7-96c3" hidden="false"/>
    <categoryEntry name="Faction: Imperial Knights" id="b5e4-3253-c157-54fd" hidden="false"/>
    <categoryEntry name="Faction: Imperium" id="0c60-6ebf-16c8-edf8" hidden="false"/>
    <categoryEntry name="Faction: Iron Hands" id="b88e-1b0c-b79f-5cdf" hidden="false"/>
    <categoryEntry name="Faction: Khorne" id="07f6-36a8-5445-5ea1" hidden="false"/>
    <categoryEntry name="Faction: Leagues of Votann" id="8474-765-16a9-f00d" hidden="false"/>
    <categoryEntry name="Faction: Legiones Daemonica" id="571f-ec3a-a5a2-751a" hidden="false"/>
    <categoryEntry name="Faction: Legions of Excess" id="db35-94d5-1c1c-6cbb" hidden="false"/>
    <categoryEntry name="Faction: Necrons" id="ee0-cf31-4fb5-6b26" hidden="false"/>
    <categoryEntry name="Faction: Nurgle" id="b971-614f-cec3-a84d" hidden="false"/>
    <categoryEntry name="Faction: Orks" id="56cc-5f43-2403-8da0" hidden="false"/>
    <categoryEntry name="Faction: Plague Legions" id="3191-fb7c-3964-4ef9" hidden="false"/>
    <categoryEntry name="Faction: Raven Guard" id="84b7-7194-3b84-1b0c" hidden="false"/>
    <categoryEntry name="Faction: Salamanders" id="65e4-13-4fa8-b36c" hidden="false"/>
    <categoryEntry name="Faction: Scintillating Legions" id="16d8-87ff-959d-86c8" hidden="false"/>
    <categoryEntry name="Faction: Slaanesh" id="1da6-f603-c562-0bec" hidden="false"/>
    <categoryEntry name="Faction: Space Wolves" id="a0d9-c115-2a-8330" hidden="false"/>
    <categoryEntry name="Faction: Thousand Sons" id="7002-1fbb-7571-e8e7" hidden="false"/>
    <categoryEntry name="Faction: Titanicus Traitoris" id="50e4-4512-21c7-3a1c" hidden="false"/>
    <categoryEntry name="Faction: Tyranids" id="d1d8-6ae0-1be7-e9e" hidden="false"/>
    <categoryEntry name="Faction: Tzeentch" id="aa0f-2495-d29f-c946" hidden="false"/>
    <categoryEntry name="Faction: T'au Empire" id="8bb1-e2c3-8725-487c" hidden="false"/>
    <categoryEntry name="Faction: Ultramarines" id="1a2d-2f00-c054-4dcb" hidden="false"/>
    <categoryEntry name="Faction: White Scars" id="5c0e-2250-dd3a-1df9" hidden="false"/>
    <categoryEntry name="Faction: World Eaters" id="bd1d-c1a5-6ca2-c791" hidden="false"/>
    <categoryEntry name="Faction: Ynnari" id="9a21-190a-9d31-35d2" hidden="false"/>
  </categoryEntries>
  <forceEntries>
    <forceEntry name="Army Roster" id="bb9d-299a-ed60-2d8a" hidden="false">
      <modifiers>
        <modifier field="a00c-6979-992f-046b" type="set" value="1000">
          <conditions>
            <condition childId="d62d-db22-4893-4bc0" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="atLeast" value="1"/>
          </conditions>
        </modifier>
        <modifier field="95c5-effd-74f1-c8f4" type="set" value="2">
          <conditions>
            <condition childId="d62d-db22-4893-4bc0" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="atLeast" value="1"/>
          </conditions>
        </modifier>
        <modifier field="606d-06be-c4b4-f877" type="set" value="2">
          <conditions>
            <condition childId="d62d-db22-4893-4bc0" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="atLeast" value="1"/>
          </conditions>
        </modifier>
      </modifiers>
      <constraints>
        <constraint id="a00c-6979-992f-046b" field="51b2-306e-1021-d207" includeChildForces="true" includeChildSelections="true" scope="parent" shared="true" type="max" value="2000"/>
        <constraint id="95c5-effd-74f1-c8f4" field="82ae-1066-5107-6ae0" includeChildForces="true" includeChildSelections="true" scope="parent" shared="true" type="max" value="3"/>
        <constraint id="606d-06be-c4b4-f877" field="f759-1bc4-cb3a-f0d2" includeChildForces="true" includeChildSelections="true" scope="force" shared="true" type="max" value="4"/>
      </constraints>
      <categoryLinks>
        <categoryLink name="Configuration" id="a088-6b0a-2dfa-dcee" hidden="false" primary="false" targetId="4ac9-fd30-1e3d-b249"/>
        <categoryLink name="Epic Hero" id="c632-3d8d-c035-6832" hidden="false" primary="false" targetId="4f3a-f0f7-6647-348d"/>
        <categoryLink name="Character" id="49e3-2b39-1e62-94aa" hidden="false" primary="false" targetId="9cfd-1c32-585f-7d5c"/>
        <categoryLink name="Battleline" id="d589-24cc-2011-705b" hidden="false" primary="false" targetId="e338-111e-d0c6-b687"/>
        <categoryLink name="Infantry" id="01be-e6a3-2a8f-8cb6" hidden="false" primary="false" targetId="cf47-a0d7-7207-29dc"/>
        <categoryLink name="Swarm" id="5ec4-5326-1b63-cb9f" hidden="false" primary="false" targetId="b00b-5bae-444f-964e"/>
        <categoryLink name="Mounted" id="8ee1-7bc1-b443-0389" hidden="false" primary="false" targetId="14a0-40c9-2748-ae6e"/>
        <categoryLink name="Beast" id="ab75-8a0d-c234-edb7" hidden="false" primary="false" targetId="4c3e-9310-a516-3590"/>
        <categoryLink name="Monster" id="c477-7baa-1cd7-11a8" hidden="false" primary="false" targetId="9693-cf84-fe69-37a9"/>
        <categoryLink name="Vehicle" id="8242-680b-0bc5-58fb" hidden="false" primary="false" targetId="dbd4-63-af05-998"/>
        <categoryLink name="Drone" id="4077-dcb0-b25e-e642" hidden="false" primary="false" targetId="2471-e2e0-3f55-d6cb"/>
        <categoryLink name="Dedicated Transport" id="0065-cb86-99e3-9547" hidden="false" primary="false" targetId="ba07-411c-2832-1f79"/>
        <categoryLink name="Fortification" id="f3ea-a5b9-82ed-b0be" hidden="false" primary="false" targetId="19d7-9c74-2140-5851"/>
        <categoryLink name="Unit" id="0ac9-d5b6-9596-c01b" hidden="false" primary="false" targetId="1160-70ae-a862-b1a8"/>
      </categoryLinks>
    </forceEntry>
  </forceEntries>
  <entryLinks>
    <entryLink name="Battle Size" id="7380-3e40-6ed6-b7cc" hidden="false" import="true" targetId="564e-fbc6-5266-3ea4" type="selectionEntry"/>
    <entryLink name="Force Disposition" id="8bc8-6bfe-78bd-2480" hidden="false" import="true" targetId="2f69-9148-45b4-86a8" type="selectionEntry"/>
  </entryLinks>
  <sharedSelectionEntries>
    <selectionEntry name="Battle Size" id="564e-fbc6-5266-3ea4" hidden="false" import="true" type="upgrade">
      <constraints>
        <constraint id="dd39-88aa-6ffd-ba88" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="min" value="1"/>
        <constraint id="b49b-cbca-13f0-3f4c" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="max" value="1"/>
      </constraints>
      <categoryLinks>
        <categoryLink name="Configuration" id="8f8f-f546-8b30-cff9" hidden="false" primary="true" targetId="4ac9-fd30-1e3d-b249"/>
      </categoryLinks>
      <selectionEntryGroups>
        <selectionEntryGroup name="Battle Size" id="b960-4789-a3a6-59cb" defaultSelectionEntryId="baf8-997f-e323-a090" hidden="false">
          <constraints>
            <constraint id="9b0b-09aa-094d-1851" field="selections" scope="parent" shared="true" type="min" value="1"/>
            <constraint id="524f-9d27-8f79-9541" field="selections" scope="parent" shared="true" type="max" value="1"/>
          </constraints>
          <selectionEntries>
            <selectionEntry name="1. Incursion (1000 Point limit)" id="d62d-db22-4893-4bc0" hidden="false" import="true" type="upgrade">
              <costs>
                <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
              </costs>
            </selectionEntry>
            <selectionEntry name="2. Strike Force (2000 Point limit)" id="baf8-997f-e323-a090" hidden="false" import="true" type="upgrade">
              <costs>
                <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
              </costs>
            </selectionEntry>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
      <costs>
        <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
      </costs>
    </selectionEntry>
    <selectionEntry name="Force Disposition" id="2f69-9148-45b4-86a8" hidden="false" import="true" type="upgrade">
      <constraints>
        <constraint id="f6b2-748d-549a-dc8a" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="min" value="1"/>
        <constraint id="7b93-b7cf-cf36-0418" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="max" value="1"/>
      </constraints>
      <categoryLinks>
        <categoryLink name="Configuration" id="8018-238d-d3f1-c882" hidden="false" primary="true" targetId="4ac9-fd30-1e3d-b249"/>
      </categoryLinks>
      <entryLinks>
        <entryLink name="Force Disposition" id="e0b7-0ab0-9d51-a9ba" hidden="false" import="true" targetId="eece-6d68-6710-7a7f" type="selectionEntryGroup"/>
      </entryLinks>
      <costs>
        <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
      </costs>
    </selectionEntry>
  </sharedSelectionEntries>
  <sharedSelectionEntryGroups>
    <selectionEntryGroup name="Force Disposition" id="eece-6d68-6710-7a7f" hidden="false">
      <constraints>
        <constraint id="741d-0fe3-eca4-5c65" field="selections" scope="parent" shared="true" type="min" value="1"/>
        <constraint id="223b-6cec-786f-8405" field="selections" scope="parent" shared="true" type="max" value="1"/>
      </constraints>
      <selectionEntries>
        <selectionEntry name="Take and Hold" id="a271-bfab-1b97-c55d" hidden="false" import="true" type="upgrade">
          <modifiers>
            <modifier field="hidden" type="set" value="true">
              <conditions>
                <condition childId="1cc1-f11a-4e8f-1bcc" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="lessThan" value="1"/>
              </conditions>
            </modifier>
          </modifiers>
          <costs>
            <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
          </costs>
        </selectionEntry>
        <selectionEntry name="Disruption" id="31ed-50f0-6571-c4c1" hidden="false" import="true" type="upgrade">
          <modifiers>
            <modifier field="hidden" type="set" value="true">
              <conditions>
                <condition childId="ecf8-cf72-7d5b-1b5b" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="lessThan" value="1"/>
              </conditions>
            </modifier>
          </modifiers>
          <costs>
            <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
          </costs>
        </selectionEntry>
        <selectionEntry name="Purge the Foe" id="7da4-f0a6-65ec-da48" hidden="false" import="true" type="upgrade">
          <modifiers>
            <modifier field="hidden" type="set" value="true">
              <conditions>
                <condition childId="6fe0-3dbe-f7e0-10bb" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="lessThan" value="1"/>
              </conditions>
            </modifier>
          </modifiers>
          <costs>
            <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
          </costs>
        </selectionEntry>
        <selectionEntry name="Priority Assets" id="081d-bc07-5d4e-ab22" hidden="false" import="true" type="upgrade">
          <modifiers>
            <modifier field="hidden" type="set" value="true">
              <conditions>
                <condition childId="0936-9767-1cc7-52ae" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="lessThan" value="1"/>
              </conditions>
            </modifier>
          </modifiers>
          <costs>
            <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
          </costs>
        </selectionEntry>
        <selectionEntry name="Reconnaissance" id="3b81-de3e-f72c-b208" hidden="false" import="true" type="upgrade">
          <modifiers>
            <modifier field="hidden" type="set" value="true">
              <conditions>
                <condition childId="b4a7-5083-fe94-4d24" field="selections" includeChildForces="true" includeChildSelections="true" scope="roster" shared="true" type="lessThan" value="1"/>
              </conditions>
            </modifier>
          </modifiers>
          <costs>
            <cost name="pts" typeId="51b2-306e-1021-d207" value="0"/>
          </costs>
        </selectionEntry>
      </selectionEntries>
    </selectionEntryGroup>
  </sharedSelectionEntryGroups>
</gameSystem>
