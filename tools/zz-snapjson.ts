import { openWorkbenchReadOnly } from "./src/semantic-authoring/db.ts";
import { compiledRecordsOf, reviewMembers } from "./src/semantic-authoring/shapes.ts";
const db = openWorkbenchReadOnly();
const ids = reviewMembers(db).map((m) => m.ability_version_id);
for (const id of ids) {
  let out: string;
  try { out = JSON.stringify(compiledRecordsOf(db, [id]).map((r: any) => r.mechanics)); } catch (e) { out = "ERR " + (e as Error).message; }
  console.log(`${id}\t${out}`);
}
