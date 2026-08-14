# Linux Computer Use

Disabled-by-default Linux Computer Use integration. It owns the seven ASAR
descriptors that used to be unconditional core port glue, the Nix staging
permission repair, and the native MCP plugin staged only when explicitly
enabled.

The feature also repairs owner-write permissions on the app's fresh bundled
marketplace staging copy. Nix store inputs are `0555`/`0444`, and Electron's
recursive copy preserves those modes before it rewrites plugin metadata. The
repair is scoped to the newly copied tree, does not follow symlinks, and leaves
the default feature-free ASAR unchanged.

Enable it in `linux-features/features.json`:

```json
{ "enabled": ["computer-use-linux"] }
```

`make install-native` builds `codex-computer-use-linux` and
`codex-computer-use-cosmic` once before staging the package. Direct
`./install.sh` builds may provide binaries in `target/release/` or set
`CODEX_COMPUTER_USE_BINARY_SOURCE` and `CODEX_COMPUTER_USE_COSMIC_BINARY_SOURCE`.
Updater rebuilds reuse the packaged artifacts and never invoke Cargo.

Validate descriptor ownership, Nix staging permissions, and artifact-only
staging with:

```bash
node --test linux-features/computer-use-linux/test.js
```
