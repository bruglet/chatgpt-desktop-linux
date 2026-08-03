# Raspberry Pi 5

The core ChatGPT Desktop for Linux build has been validated on a 16 GB
Raspberry Pi 5. The existing upstream ARM64 support built and ran without a
Pi-specific source patch.

This page records a field test, not a separate Raspberry Pi port. ARM64 support
comes from the work already maintained in this repository by
[@ilysenko](https://github.com/ilysenko) and its contributors.

## Validated environment

The successful test used:

- Raspberry Pi 5 with 16 GB RAM
- 64-bit Debian 13 (trixie), `aarch64`
- NVMe storage
- LightDM with the Raspberry Pi Labwc Wayland desktop
- 1920x1080 display output
- repository version `0.10.4` at commit `ab314923b5bf`
- upstream ChatGPT app version `26.727.51351`
- Electron `42.3.0`

The native build acceptance verdict was `accepted`, with no blockers or
warnings. The generated Debian package reported `Architecture: arm64`, and the
Electron executable, native Node modules, Linux helpers, and Codex CLI platform
binary were verified as AArch64 executables.

## Build and install

Use a 64-bit operating system. Active cooling and SSD or NVMe storage are
recommended for the native build.

The repository's normal Debian-family setup path should be used:

```bash
git clone https://github.com/ilysenko/codex-desktop-linux.git
cd codex-desktop-linux
PACKAGE_WITH_UPDATER=0 MAX_BUILD_THREADS=4 make bootstrap-native
```

`PACKAGE_WITH_UPDATER=0` keeps the first Pi installation simple by omitting the
automatic rebuild service. After the baseline is stable, it can be evaluated
separately. Limiting build parallelism to four jobs is a conservative starting
point for Pi thermals and responsiveness.

The tested run performed the same stages separately:

```bash
bash scripts/install-deps.sh
PACKAGE_WITH_UPDATER=0 MAX_BUILD_THREADS=4 make build-app-fresh
PACKAGE_WITH_UPDATER=0 MAX_BUILD_THREADS=4 make deb
```

Install the generated package from `dist/` with the normal Debian package
manager. Do not download or redistribute someone else's generated package:
this project intentionally performs the conversion locally from the official
upstream application.

## Desktop setup

The application needs a graphical desktop session. A Pi configured for
console-only boot must have its existing display manager enabled before the
desktop launcher can be tested. The validated system used LightDM automatic
login with the Raspberry Pi Labwc session.

After installation, start **ChatGPT** from the desktop menu. The first launch
may install or update the Codex CLI. If manual setup is needed, include the
optional platform dependency:

```bash
npm install -g --include=optional --prefix ~/.local @openai/codex
```

## Validation results

The following checks passed on the test Pi:

- clean ARM64 app build and native module rebuild
- native `arm64` Debian package creation and installation
- graphical reboot into the Labwc Wayland desktop
- application launch from the live desktop session
- correctly rendered ChatGPT sign-in window
- account sign-in
- Codex app-server startup using the ARM64 Codex CLI
- workspace file creation and editing
- integrated command execution
- Python, SQLite, automated test, and local Git workflows

## Optional capability results

Browser Use and Computer Use were not available in the validated Pi session.
The core workflow test did not diagnose a single cause for both features, so
their absence should not be attributed solely to ARM64. Computer Use UI access
can also depend on local opt-in and upstream account rollout.

One known architecture-specific gap remains: the repository's Browser Use
`node_repl` fallback resource is currently x86-64-only when no compatible
upstream or user-supplied ARM64 binary is available. Treat Browser Use and
Computer Use as unavailable on this validated baseline until separate ARM64
testing demonstrates otherwise.

## Remaining validation

Long-running thermal behavior, peak memory use, and the automatic update
manager were not measured during this first validation.

## Reporting Pi issues

Include the following when reporting a Raspberry Pi problem:

- Pi model and RAM size
- operating system and architecture from `uname -m`
- desktop environment and X11 or Wayland session type
- repository commit and upstream app version
- exact build command
- package format
- relevant output from `~/.cache/codex-desktop/launcher.log`

Keep generated applications and packages out of pull requests. Documentation,
diagnostics, tests, and fixes should target the repository sources.
