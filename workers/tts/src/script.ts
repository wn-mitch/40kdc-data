/**
 * The Lua that Yellowscribe's Tabletop Simulator mod runs, vendored from
 * github.com/ThePants999/Yellowscribe (CC0-1.0, commit 237bfd55):
 * `lua_modules/MatchedPlay*.lua` and the Yellow Machine object script
 * (`YellowMachine.lua`).
 */
import matchedPlayConstants from "../lua/MatchedPlay_Constants.lua";
import matchedPlay from "../lua/MatchedPlay.lua";
import yellowMachine from "../lua/YellowMachine.lua";

interface ScriptModule {
  constants: string;
  module: string;
  /** Hotkey slot (1–10) → the Lua function bound to it. */
  keys: Record<string, string>;
}

/** Yellowscribe's `lua_modules/module_mapping.json` for the modules vendored here. */
const MODULES: Record<string, ScriptModule> = {
  MatchedPlay: {
    constants: matchedPlayConstants,
    module: matchedPlay,
    keys: {
      "1": "function (playerColor) showCard('dataCard', playerColor) end",
      "2": "function (playerColor, target) changeModelWoundCount(-1, target) end",
      "3": "function (playerColor, target) changeModelWoundCount(1, target) end",
      "4": "function (playerColor, target) changeMeasurementCircle(1, target) end",
      "5": "function (playerColor, target) changeMeasurementCircle(-1, target) end",
      "6": "function (playerColor, target) assignBase(-1, target) end",
      "7": "function (playerColor, target) assignBase(1, target) end",
      "8": "toggleRectangularMeasuring",
    },
  },
};

export const KNOWN_MODULES: readonly string[] = Object.keys(MODULES);

/**
 * The `baseScript` the mod attaches to every model, built the way Yellowscribe's
 * `ScriptBuilder.build` does: constants, then modules, then the ten-slot
 * `scriptingFunctions` table. Unknown module names are ignored.
 */
export function buildScript(names: readonly string[]): string {
  const modules = names.flatMap((n) => (MODULES[n] ? [MODULES[n]] : []));
  const slots: string[] = new Array(10).fill("\tnone");
  for (const m of modules) for (const [key, fn] of Object.entries(m.keys)) slots[Number(key) - 1] = `\t--[[${key}]]${" ".repeat(3 - key.length)}${fn}`;
  const scripts = [
    "local scriptingFunctions",
    ...modules.map((m) => m.constants),
    ...modules.map((m) => m.module),
    `-- this needs to be defined after all scripting functions\nscriptingFunctions = {\n${slots.join(",\n")}\n}`,
  ];
  return "\n".repeat(5) + scripts.join("\n".repeat(5));
}

const UPSTREAM_ENDPOINT = "https://yellowscribe.link/get_army_by_id?id=";

/** The Yellow Machine script with its army fetch pointed at `origin` instead of yellowscribe.link. */
export function machineScript(origin: string): string {
  return yellowMachine.replace(UPSTREAM_ENDPOINT, `${origin}/get_army_by_id?id=`);
}
