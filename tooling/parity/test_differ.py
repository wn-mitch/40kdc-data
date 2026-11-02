import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import differ


class FakeRunner:
    def __init__(self, impl, unsupported):
        self.impl = impl
        self.impl_version = "fixture"
        self.unsupported = unsupported

    def call(self, request):
        if request["op"] in self.unsupported:
            return {"ok": False, "error_kind": "UNKNOWN_OP"}
        return {"ok": False, "error_kind": "INVALID_INPUT"}


class ParityTests(unittest.TestCase):
    def test_default_commands_ignore_existing_binaries(self):
        with patch.object(Path, "exists", return_value=True):
            self.assertEqual(differ.default_ts_cmd()[0], str(differ.REPO_ROOT / "tools/node_modules/.bin/tsx"))
            self.assertEqual(differ.default_rust_cmd(), ["cargo", "run", "--quiet", "--release", "--bin", "wh40kdc-runner"])
            self.assertEqual(differ.default_go_cmd(), ["go", "run", "-C", "go", "./cmd/wh40kdc-runner"])
        with patch.object(Path, "exists", return_value=False):
            self.assertEqual(differ.default_ts_cmd()[0], str(differ.REPO_ROOT / "node_modules/.bin/tsx"))

    def test_only_rust_compare_and_loadout_are_expected(self):
        ts = FakeRunner("ts", set())
        rust = FakeRunner("rust", {"compare", "loadout"})
        report = differ.run_corpus(ts, rust, differ.CORPUS_DEFAULT, ["compare", "loadout"], tol=0, fail_fast=False, quiet=True)
        self.assertTrue(report.ok)
        self.assertEqual(report.skipped, {"compare": 1, "loadout": 1})
        ts.unsupported = {"translate_effect"}
        report = differ.run_corpus(ts, rust, differ.CORPUS_DEFAULT, ["effect-translation"], tol=0, fail_fast=False, quiet=True)
        self.assertFalse(report.ok)
        self.assertEqual(report.unexpected_skips, [{"area": "effect-translation", "op": "translate_effect", "runner": "ts"}])

    def test_missing_ts_operation_exits_nonzero(self):
        # Real NDJSON subprocesses exercise CLI exit status and the JSON report.
        code = '''import json,sys\nfor line in sys.stdin:\n r=json.loads(line); op=r["op"]\n if op=="init": out={"ok":True,"value":{"impl":sys.argv[1],"impl_version":"fixture","spec_version":r["args"]["spec_version"]}}\n elif op=="translate_effect" and sys.argv[1]=="ts": out={"ok":False,"error_kind":"UNKNOWN_OP"}\n else: out={"ok":False,"error_kind":"INVALID_INPUT"}\n print(json.dumps(out),flush=True)\n'''
        import shlex
        command = lambda impl: shlex.join([sys.executable, "-u", "-c", code, impl])
        result = subprocess.run([sys.executable, str(Path(differ.__file__)), "--pair", "ts,py", "--area", "effect-translation", "--ts-cmd", command("ts"), "--py-cmd", command("py"), "--json", "--quiet"], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        output = json.loads(result.stdout)
        self.assertFalse(output["ok"])
        self.assertEqual(output["unexpected_skips"][0], {"area": "effect-translation", "op": "translate_effect", "runner": "ts"})


if __name__ == "__main__":
    unittest.main()
