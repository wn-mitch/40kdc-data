# ruff: noqa: E501 -- the embedded TypeScript header is kept on one line per statement.
"""Re-record ``python/tests/phase4_shapes.json`` from the TypeScript reference.

Rewrites ``tools/test/translate-phase4-shapes.test.ts`` into a script that records every
describer / cruncher call (arguments and TS output), appends the extra cases in
``extra.ts`` and runs it with tsx. Run from anywhere:

    python3 python/tests/fixtures/phase4_shapes_gen/make_recorder.py
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
src = (ROOT / "tools/test/translate-phase4-shapes.test.ts").read_text()
# drop imports
src = re.sub(r"^import .*?;\n", "", src, flags=re.M | re.S)
T = str(ROOT / "tools/src")
head = f'''
import {{ effectToBuffs as _e2b }} from "{T}/cruncher/from-dsl.ts";
import type {{ BuffSource, EngineContext }} from "{T}/cruncher/buffs.ts";
import {{ usageGated as _ug }} from "{T}/data/entities.ts";
import {{ describeAbility as _da, describeCondition as _dc, type Effect }} from "{T}/translate/index.ts";
import {{ describeTrigger as _dt }} from "{T}/translate/trigger.ts";
import {{ writeFileSync }} from "node:fs";
const REC: unknown[] = [];
const rec = (fn: string, f: (...a: any[]) => any) => (...args: any[]) => {{ const out = f(...args); REC.push({{ fn, args: JSON.parse(JSON.stringify(args)), out: JSON.parse(JSON.stringify(out ?? null)) }}); return out; }};
const describeAbility = rec("describeAbility", _da as any);
const describeCondition = rec("describeCondition", _dc as any);
const describeTrigger = rec("describeTrigger", _dt as any);
const effectToBuffs = rec("effectToBuffs", _e2b as any);
const usageGated = rec("usageGated", _ug as any);
const describe = (_n: string, f: () => void) => f();
const it = (_n: string, f: () => void) => f();
const M: any = {{ toBe() {{}}, toContain() {{}}, toEqual() {{}}, toHaveLength() {{}}, toMatch() {{}} }};
const expect = (_x: unknown) => ({{ ...M, not: M }});
'''
tail = (HERE / "extra.ts").read_text()
tail += '\nwriteFileSync(process.argv[2], JSON.stringify(REC, null, 1) + "\\n");\n'
out = HERE.parent / "phase4_shapes.json"
with tempfile.NamedTemporaryFile("w", suffix=".ts", delete=False) as f:
    f.write(head + src + tail)
subprocess.run(
    [str(ROOT / "tools/node_modules/.bin/tsx"), f.name, str(out)], check=True, cwd=ROOT / "tools"
)
print(f"wrote {out}", file=sys.stderr)
