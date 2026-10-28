# Fork merge checks

The target policy requires `source-and-node`, `rust`, `upstream-acceptance`, and
both Homebrew `validate` jobs on an up-to-date branch.

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

## Apply the fork settings

These steps require repository settings access. The code connection can open
PRs but may lack permission to edit rulesets or Actions variables.

1. Edit the fork's **main Protection** ruleset. Remove `nix` and
   `official-linux-gate` from required checks. Add `upstream-acceptance` from
   GitHub Actions. Retain `source-and-node`, `rust`, both Homebrew `validate`
   checks, branch freshness and every other protection.
2. Under **Settings → Secrets and variables → Actions → Variables**, add or
   update `MAX_OPEN_PRS_PER_CONTRIBUTOR_OVERRIDES` with `"bruglet": 10` in its
   JSON object. Preserve any existing entries. For example: `{"bruglet":10}`.
   This prevents upstream's default two-PR limit from closing the owner's fix
   while the sync and cask automation already have open PRs.
3. Reopen the fork check PR and enable auto-merge. Wait for the required checks.
4. After it merges, run **Sync Ready Upstream** (or wait for its hourly run).
   It refreshes the sync branch against the new default branch, runs the new
   acceptance check and enables auto-merge for the upstream sync PR.
