// Command wh40kdc-runner is the Go NDJSON conformance runner. It speaks the
// wire protocol in conformance/RUNNER_PROTOCOL.md so the cross-implementation
// differ (tooling/parity/differ.py) can pair it against the TS, Rust, and
// Python runners.
package main

import (
	"os"

	wh40kdc "github.com/wn-mitch/40kdc-data/go"
)

func main() {
	if err := wh40kdc.RunnerMain(os.Stdin, os.Stdout); err != nil {
		os.Exit(1)
	}
}
