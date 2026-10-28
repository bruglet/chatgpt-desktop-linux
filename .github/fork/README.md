# Fork merge checks

The fork requires `source-and-node`, `rust`, `upstream-acceptance`, and both
Homebrew `validate` jobs on an up-to-date branch.

The fork-owned acceptance workflow checks automated upstream sync PRs against
the exact upstream revision's successful official Linux build on its default
branch. Other fork PRs use the existing source, Rust and Homebrew checks.

Inherited `nix` and `official-linux-gate` checks remain visible diagnostics.
They are not merge requirements: a new OpenAI package can invalidate upstream
pins or patches after upstream accepted a revision. Requiring those checks
would stop the fork from importing an already accepted upstream commit.

This policy permits source synchronization. It does not qualify a Homebrew
release. Candidate generation still requires pins to match the current signed
campaign; publishing still requires signed DEB/RPM comparison, actual cask
lifecycle tests on both architectures, and rejection of stale candidates.
If upstream has package drift, the release stays blocked until upstream repairs
it and the fork imports that repair. No upstream files are patched downstream.
