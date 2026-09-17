# Papercuts

Small repository frictions recorded while doing real work.

## 2026-08-05T17:38:48Z — openai-codex/gpt-5.6-sol

A remembered .claude/skills/dsl-campaign path was absent in the current workspace, causing a parallel inspection batch to fail before returning independent results.

## 2026-08-05T19:17:02Z — openai-codex/gpt-5.6-sol

jj status refused to snapshot a 39.9 MiB untracked session HTML file, adding repeated warning noise and preventing a clean workspace snapshot.

## 2026-08-05T21:39:11Z — openai-codex/gpt-5.6-sol

Browser request interception did not surface EventSource stream requests, so the documented interception path could not drive staged SSE commits and required a localhost fixture server instead.

## 2026-08-05T22:07:50Z — openai-codex/gpt-5.6-sol

The required killport helper is unavailable, so a failed combined-server launch could not use the mandated port cleanup command.

## 2026-08-06T00:54:08Z — openai-codex/gpt-5.6-sol

Browser open waited on Vite networkidle0 and timed out because the dev UI keeps a connection open; the tab may still be usable, but the error obscures that state.

## 2026-08-06T02:42:10Z — openai-codex/gpt-5.6-sol

Impeccable skill required .claude/skills/impeccable/scripts/load-context.mjs, but the prescribed project-relative path does not exist in this workspace, blocking its non-optional context loader.


## 2026-08-06T15:26:09Z — gpt-5.6-sol

Impeccable setup documents a repo-local .claude loader path, but this repository only exposes the skill through skill://, causing the prescribed command to fail before context loading.

## 2026-08-06T20:55:48Z — gpt-5.6-sol

The campaign skill and agent outputs referenced tools/src/translate/cli.ts, but that path does not exist; attempting the documented translation validation command failed before validation and required locating the current CLI.

## 2026-08-07T15:27:24Z — openai-codex/gpt-5.6-sol

jq was invoked over multiple faction JSON files without slurping, producing one report per file and exiting 5 instead of one corpus-wide enum summary; use jq -s/add for this lookup.

## 2026-08-13T19:05:11Z — openai-codex/gpt-5.6-sol

Running the documented jj workspace update-stale precondition rebased this workspace onto a conflicted divergent parent and surfaced dozens of unrelated conflicts, blocking safe implementation until workspace lineage is reconciled.

## 2026-08-13T19:50:33Z — openai-codex/gpt-5.6-sol

A one-off Python text replacement against a truncated long line failed because the assumed literal occurred more than once after an earlier edit; anchored file edits are safer for long generated-style workflow lines.

## 2026-08-13T20:28:59Z — openai-codex/gpt-5.6-sol

Root just preflight invokes system pip install and fails under Homebrew's PEP 668 externally-managed environment instead of using the repository virtualenv, blocking the documented gate after artifact regeneration.

## 2026-08-13T23:32:19Z — openai-codex/gpt-5.6-sol

A jq schema-introspection query failed on a parenthesis error while enumerating effect wrapper child fields, adding an avoidable discovery round trip; use a simpler staged jq expression for nested  checks.

## 2026-08-14T15:49:00Z — gpt-5.6-sol

The extant claim importer timed out after an hour because every nested event rebuilt all node ability references; bulk graph transactions need one deferred reference rebuild at commit.

## 2026-08-14T18:57:39Z — gpt-5.6-sol

Live schema-five claim migration with candidate import exceeded the one-hour command timeout; candidate persistence is too slow for the 40k corpus and needs batching or indexing before retry.

## 2026-08-15T18:31:17Z — gpt-5.6-sol

The OMP Eval JavaScript runtime could not import the campaign GraphStore because Bun cannot resolve Node 22's node:sqlite module, so graph-backed workflow helpers cannot run directly in Eval despite the workflow scripts being JavaScript.

## 2026-08-15T19:25:38Z — gpt-5.6-sol

The installed jq-compatible CLI rejects the standard input_filename filter, so multi-file JSON diagnostics cannot label source files as expected; this forced a separate file-enumeration step.

## 2026-08-15T22:20:19Z — gpt-5.6-sol

The graph-backed verification workflow serializes a long skitarius gate before six review agents; the 30-minute subagent cap terminated the driver and subsequent agent calls hit the usage limit, leaving later request files unresolved. Long mechanical gates should run outside the model call or in a separately resumable wave.

## 2026-08-15T22:46:32Z — gpt-5.6-sol

tooling/parity/differ.py prefers an existing stale target/release runner over a freshly rebuilt target/debug runner, producing false cross-port divergences and an old version report. The CLI should detect freshness/version or prefer an explicitly rebuilt debug binary during local iteration.

## 2026-08-15T22:58:52Z — openai-codex/gpt-5.6-sol

Fresh Go runner build from the repository root failed because the Go module lives under go/. Use 'go -C go build' for parity runner rebuilds.

## 2026-08-15T23:01:09Z — openai-codex/gpt-5.6-sol

The Bun-backed JS eval cannot import the graph runtime because it depends on Node's built-in node:sqlite module. Campaign lifecycle repairs therefore require a temporary Node script or a graph CLI command.

## 2026-08-15T23:12:11Z — openai-codex/gpt-5.6-sol

gh pr create in the jj workspace failed because the workspace has no .git directory. Pass --repo explicitly when opening PRs from /Users/will.mitchell/40kdc-dsl.

## 2026-08-20T19:13:10Z — gpt-5.6

The Codex workspace ran out of disk space during a JSON write because a 335 MB OCR orientation scratch directory remained under /tmp; the failed write had to be verified before retrying after cleanup.

## 2026-08-20T22:37:07Z — gpt-5.6-sol

The pack extractor resolves PDF and store arguments against the repository root even when invoked from tools; passing ../_private from the tools cwd escaped the repo and failed before extraction.

## 2026-08-20T22:51:02Z — gpt-5.6-sol

python/.venv is editable-installed against /private/tmp/40kdc-maps-ci-fix rather than this workspace, so focused pytest silently exercised stale source until PYTHONPATH=python/src was set.

## 2026-08-20T22:57:16Z — gpt-5.6-sol

npm run mfm:golden silently rewrote the committed MFM 925 golden and gaps from the local stale data_version 895 dump; the command needs a downgrade guard before writing.

## 2026-08-21T00:00:39Z — openai-codex/gpt-5.6-sol

author:ingest resolves manifest paths from tools/ despite AGENTS.md saying tool path args resolve from the repo root; a documented repo-relative _private/manifests path was reported missing.

## 2026-08-21T00:17:58Z — openai-codex/gpt-5.6-sol

AGENTS.md documents an upstream remote for 40kdc-data, but this workspace has no upstream remote;  fails and the actual canonical remote must be inferred from repository metadata.

## 2026-08-21T00:37:55Z — openai-codex/gpt-5.6-sol

The advertised silent-failure-hunter and pr-test-analyzer agents failed immediately with 'No model selected', so their review slices could not run.

## 2026-08-21T04:19:52Z — codex

author:input hard-fails when the optional ~/army-assist checkout is absent, even though the sibling raw-text store already contains the required rules; this blocks refreshing source-grounded repair inputs.

## 2026-08-21T14:07:44Z — openai-codex/gpt-5.6-sol

tsx -e could not resolve a local TypeScript module imported with a .js suffix, despite repository source imports using extensionless TypeScript paths; the validation one-liner failed before execution.

## 2026-08-21T14:10:07Z — openai-codex/gpt-5.6-sol

Codex raw-store records can carry phases: null despite phase comparison code expecting arrays; jq phase audits must normalize with // [].

## 2026-08-21T14:30:08Z — openai-codex/gpt-5.6-sol

The new just regen recipe attempted a global editable pip install on macOS and failed under PEP 668, blocking preflight despite all Python tooling already being installed. Regeneration should not mutate the package environment.

## 2026-08-21T16:30:16Z — gpt-5.6-sol

Temporary model-adapter PATH omitted the active NVM bin, so npm failed before running; prepend /tmp to the inherited PATH instead.

## 2026-08-21T16:47:45Z — gpt-5.6-sol

The raw-text store's verification script writes a 4.9 MiB unignored dist/bundle-abilities.json, which jj refuses to snapshot; verification requires manually deleting this transient output.

## 2026-08-21T16:57:34Z — gpt-5.6-sol

gh cannot infer a repository from a colocated jj workspace that lacks a .git directory; raw-store PR commands must pass the explicit -R repository.

## 2026-08-28T15:11:14Z — openai-codex/gpt-5.6-sol

A live Battlemaster re-projection strips committed keystones, but the documented derive-keystones --rederive follow-up now fails on a 0.5-inch pairing difference in bm-disrupt-vs-disrupt-01, preventing the projected data from being restored.

## 2026-08-28T16:19:22Z — openai-codex

The layout-editor workspace has no local Prettier binary, so its ordinary npx prettier command fails; formatting must be invoked through the root tools workspace.

## 2026-08-28T16:29:49Z — openai-codex

The layout-editor production build emitted its bundle-size table but then hung until the 10-minute command timeout while a persistent Vite dev server was running; the same build normally exits in seconds.

## 2026-09-03T19:08:57Z — codex

Phase 5 names the audit as npx tsx tools/src/audit-loadout-coverage.ts, but I reflexively ran the tools-only npm script from the repository root; npm failed before regeneration and made no project changes.

## 2026-09-03T19:18:39Z — codex

I ran a jq probe with a literal TARGET placeholder instead of first extracting the BSData target id; it returned an empty result and provided no diagnostic value.

## 2026-09-03T19:23:34Z — codex

This installed jj version has no archive subcommand, so the planned whole-parent materialization failed before comparison; use jj file show per composition instead.

## 2026-09-08T16:37:21Z — gpt-6-astra

The supplied review appeared only as truncated inline text, with no recoverable attachment URI. Earlier local exports were different reviews, so the full finding inventory requires the original Markdown upload.

## 2026-09-08T16:49:20Z — gpt-6-astra

The CLI rejects --list-models; model availability is exposed by omp models find, while pi/task must first be resolved through omp config get modelRoles.

## 2026-09-08T18:08:23Z — gpt-6-astra

Eval's edit bridge takes an undocumented input field and returns hasError instead of throwing; unchecked calls left an intended edit unapplied. The bash wildcard expansion also emitted nonexistent suffix paths rather than matching full paths.

## 2026-09-08T19:03:03Z — gpt-6-astra

Runner protocol documentation showed init fields at top level, but the actual runner requires args; corrected the example. Rust codegen also requires refreshing the schema bundle first, and its flattener accepts only whole-file or top-level definition references.

## 2026-09-08T19:18:01Z — gpt-6-astra

Rust loadout coverage is not a standalone integration target; cargo test --test loadout fails. Use cargo test -p wh40kdc loadout to select the embedded and API tests.

## 2026-09-08T20:51:05Z — gpt-6-astra

A subagent reported private JSON proposal paths that were absent from the parent workspace. Recovering and publishing the existing artifacts required a second handoff before validation could run.

## 2026-09-10T14:09:16Z — openai-codex/gpt-5.6-sol

A jj log query failed because GitHub exposed an external-fork PR SHA that the local jj repo had not fetched. Check ref availability or add the contributor remote before including external PR SHAs in one revision set.

## 2026-09-10T14:19:43Z — openai-codex/gpt-5.6-sol

A PR data-review subagent ran to completion but yielded null data, so the canonical data and stock-loadout audit had to be dispatched again.

## 2026-09-10T17:15:14Z — terra

Layout Editor's npm run check cannot run because svelte-check is not installed in the workspace; verification requires restoring dependencies first.

## 2026-09-10T20:45:02Z — terra

The approved index-rebuild command used ../../40kdc-abilities from tools, which resolves to /Users/40kdc-abilities rather than the sibling store; the command failed before regeneration.

## 2026-09-10T20:51:58Z — terra

just preflight runs verify-clean against @ after regeneration, so it always fails while an uncommitted data change correctly updates generated artifacts; use verify-regen-stable plus test-all before committing.

## 2026-09-10T20:56:44Z — terra

jj -R ../40kdc-abilities diff rejects an unqualified README.md path as rooted in the invoking repo; cross-repo file selection requires root:"README.md".

## 2026-09-11T13:53:08Z — openai-codex/gpt-5.6-sol

The impeccable skill required a project-local .agents/skills/impeccable context loader, but this repository has no such installed path; the command failed before review UI work.

## 2026-09-11T15:42:38Z — openai-codex/gpt-5.6-sol

Impeccable requires .agents/skills/impeccable/scripts/load-context.mjs, but this repo has no .agents directory; the documented loader path fails before UI work.

## 2026-09-11T16:49:41Z — terra

tools has no test:conformance script; the focused conformance command must be discovered from package scripts after the alias fails.

## 2026-09-11T19:47:11Z — openai-codex/gpt-5.6-sol

Impeccable instructed running a repo-local .agents loader, but this repository has no installed .agents skill directory; the documented command failed before design work.

## 2026-09-11T20:22:38Z — openai-codex/gpt-5.6-sol

Browser observation did not expose the empty-state file input as a button, so the initial acceptance-bundle upload lookup failed; selecting the underlying input directly was required.

## 2026-09-11T21:16:07Z — openai-codex/gpt-5.6-sol

Claude CLI accepted the structured-output schema locally but the API rejected top-level allOf with a 400; the help text does not document this schema subset, so the 13-item retry checkpoint failed without token spend.

## 2026-09-14T23:37:51Z — openai-codex/gpt-5.6-sol

The repository guidance names upstream/main, but jj has no upstream/main revision, so the initial lineage query failed and required inspecting the local main bookmark instead.

## 2026-09-16T18:59:29Z — openai-codex/gpt-5.6-sol

Root npx tsx resolved to a missing shell command even though both root and tools node_modules contain tsx; invoking the installed binary directly was required.

## 2026-09-16T23:30:52Z — openai-codex/gpt-5.6-sol

The reviewed bundle's missing-shape flag was not at the assumed shape_report.needs_schema path, causing a dead-end jq query while advancing the triage queue.

## 2026-09-16T23:43:15Z — openai-codex/gpt-5.6-sol

Used the wrong copied PDF basename in pdfinfo (11th instead of 11e), causing an avoidable dead-end metadata call.

## 2026-09-16T23:45:05Z — openai-codex/gpt-5.6-sol

A root-wide ignored-file glob for environment files timed out because the repository tree is large; narrower per-directory globs were required.

## 2026-09-16T23:46:07Z — openai-codex/gpt-5.6-sol

A broad home-directory glob timed out before locating this repository; repository discovery needed a scoped home-directory listing.

## 2026-09-17T00:54:23Z — openai-codex/gpt-5.6-sol

The impeccable skill instructed running a project-relative  loader, but this repo has no such checkout; the harness-installed  path is required.

## 2026-09-17T01:29:07Z — openai-codex/gpt-5.6-sol

An extra parenthesis in a long jq selector caused a dead-end query while inspecting affected ability entries.

## 2026-09-17T02:47:46Z — openai-codex/gpt-5.6-sol

gh search issues treated the parenthesized OR query as part of the repo qualifier and rejected it, so issue searches need separate simple queries.

## 2026-09-17T11:28:08Z — openai-codex/gpt-5.6-sol

jq rejected a damage-ability regex because the inline shell/regex escaping was easy to mis-specify; use character classes instead of backslash-escaped plus signs in inline jq patterns.

## 2026-09-17T13:22:21Z — opus

just preflight's drift gate compares against the working copy (@), so it can only pass on a committed tree: bumping conformance/SPEC_VERSION then running preflight costs a commit, a multi-minute regen, a failure naming go/spec.go and python/src/wh40kdc/_spec.py, and a second commit+preflight.

## 2026-09-17T14:01:10Z — opus

just regen never rebuilds data/share-registry.json, so adding entity ids leaves share.test failing on 'allocates every current shareable id' until you run npm run registry:build by hand — and it must run AFTER npm run codegen:data (registry:build reads the generated bundle), which is the opposite of the documented 'registry:build BEFORE codegen:data' order, so a naive single pass silently no-ops.

## 2026-09-17T17:45:43Z — deepseek-v4

referential-integrity's collision-policy test has a 5000ms default vitest timeout but takes ~2.5s alone and >6s under load, so a concurrent heavy job makes the suite fail flakily.

## 2026-09-17T19:39:32Z — deepseek-v4-flash

Widening an enum in effect.schema.json makes 'just regen' fail with a ~40-line recursive TypeScript union-mismatch dump (generated.ts widens automatically but hand-written interfaces in tools/src/translate/effect.ts do not), and the error names the deepest nested type rather than the stale interface, so the actual fix (width of one hand-written union) is hard to see.

## 2026-09-17T20:30:20Z — deepseek/deepseek-v4-flash

Adding @types/node to one npm workspace hoists it to the root node_modules/@types, so the Node types silently become ambient in every sibling workspace; it surfaced an unrelated setTimeout return-type error in examples/mechanic-evidence and forced a fix outside the workspace being changed.
