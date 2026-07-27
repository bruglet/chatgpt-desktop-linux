#!/usr/bin/env node

import {
  chmodSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PATCH_ID = "downstream-appimage-stable-instance-v1";
const PATCH_MARKER = `# ${PATCH_ID}`;
const DEFAULT_TARGET = "launcher/start.sh.template";
const EXACT_PATH_GUARD =
  '    pid_arg0_matches_path "$actual" "$expected" || return 1';
const APPIMAGE_AWARE_GUARD = `    if ! pid_arg0_matches_path "$actual" "$expected"; then
        # ${PATCH_ID}
        # AppImage invocations mount at different temporary paths. Match a
        # running Electron from the same AppImage file and application identity.
        [ -n "\${APPIMAGE:-}" ] || return 1
        [ -n "\${APPDIR:-}" ] || return 1
        case "$expected" in
            "$APPDIR"/*) ;;
            *) return 1 ;;
        esac
        case "\${actual##*/}" in
            electron|electron\\ *) ;;
            *) return 1 ;;
        esac
        pid_matches_app_identity "$pid" || return 1
        [ "$(pid_environ_value "$pid" APPIMAGE 2>/dev/null || true)" = "$APPIMAGE" ] || return 1
        local process_appdir
        process_appdir="$(pid_environ_value "$pid" APPDIR 2>/dev/null || true)"
        [ -n "$process_appdir" ] || return 1
        case "$actual" in
            "$process_appdir"/*) ;;
            *) return 1 ;;
        esac
    fi`;

export class PatchFailure extends Error {
  constructor(code, reason, evidence, nextSteps) {
    super(reason);
    this.name = "PatchFailure";
    this.code = code;
    this.evidence = evidence;
    this.nextSteps = nextSteps;
  }
}

function usage() {
  return `Usage:
  node .github/scripts/apply-appimage-single-instance-fix.mjs [--apply|--check|--verify] [target]

Modes:
  --apply   Apply the patch atomically, or verify it if already applied (default).
  --check   Confirm that the current upstream launcher can be patched; do not write.
  --verify  Confirm that the target already contains a valid patch.

Default target: ${DEFAULT_TARGET}`;
}

function parseArguments(argv) {
  let mode = "apply";
  let target = DEFAULT_TARGET;
  let targetWasSet = false;

  for (const argument of argv) {
    if (argument === "--apply" || argument === "--check" || argument === "--verify") {
      mode = argument.slice(2);
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (argument.startsWith("-")) {
      throw new PatchFailure(
        "E_USAGE",
        `Unknown option: ${argument}`,
        [],
        ["Run the script with --help to see the accepted modes."],
      );
    }
    if (targetWasSet) {
      throw new PatchFailure(
        "E_USAGE",
        `More than one target was provided: ${target} and ${argument}`,
        [],
        ["Pass at most one launcher path after the mode."],
      );
    }
    target = argument;
    targetWasSet = true;
  }

  return { mode, target: path.resolve(target) };
}

function countOccurrences(source, needle) {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function functionBlock(source, name) {
  const lines = source.split("\n");
  const header = `${name}() {`;
  const starts = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === header) {
      starts.push(index);
    }
  }

  if (starts.length !== 1) {
    throw new PatchFailure(
      "E_FUNCTION_SHAPE",
      `Expected exactly one ${name}() function, but found ${starts.length}.`,
      [`Expected header: ${header}`],
      [
        `Inspect upstream's current ${name}() implementation.`,
        "Do not force the patch; update this transform only after confirming the new launcher behavior.",
      ],
    );
  }

  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    if (lines[index] === "}") {
      return lines.slice(starts[0], index + 1).join("\n");
    }
  }

  throw new PatchFailure(
    "E_FUNCTION_SHAPE",
    `${name}() has no standalone closing brace.`,
    [`Function starts at line ${starts[0] + 1}.`],
    [
      `Inspect upstream's current ${name}() implementation.`,
      "Do not force the patch onto an unrecognized function shape.",
    ],
  );
}

function assertRequiredFunctions(source) {
  for (const name of [
    "pid_environ_value",
    "pid_matches_executable",
    "pid_matches_app_identity",
  ]) {
    functionBlock(source, name);
  }
}

function validateUnpatched(source) {
  assertRequiredFunctions(source);

  const markerCount = countOccurrences(source, PATCH_MARKER);
  if (markerCount !== 0) {
    throw new PatchFailure(
      "E_PARTIAL_PATCH",
      `Found ${markerCount} patch marker(s), but the patched launcher did not pass verification.`,
      [`Marker: ${PATCH_MARKER}`],
      [
        "Do not apply the transform again.",
        "Inspect the marked pid_matches_executable() block and compare it with this script's postconditions.",
      ],
    );
  }

  const block = functionBlock(source, "pid_matches_executable");
  const guardCount = countOccurrences(block, EXACT_PATH_GUARD);
  if (guardCount !== 1) {
    throw new PatchFailure(
      "E_EXACT_PATH_GUARD_DRIFT",
      `pid_matches_executable() contains ${guardCount} copies of the expected exact-path guard; expected exactly one.`,
      [`Expected line: ${EXACT_PATH_GUARD.trim()}`],
      [
        "Review upstream's current pid_matches_executable() implementation and its callers.",
        "If upstream added AppImage-stable identity handling, remove this downstream patch.",
        "Otherwise update the transform and its failure-mode tests for the new function shape.",
      ],
    );
  }
}

function validatePatched(source) {
  assertRequiredFunctions(source);

  const markerCount = countOccurrences(source, PATCH_MARKER);
  if (markerCount === 0) {
    throw new PatchFailure(
      "E_PATCH_NOT_APPLIED",
      `The target does not contain the ${PATCH_ID} marker.`,
      [],
      [
        "If this is the source launcher, run --check and then --apply.",
        "If this is an extracted AppImage launcher, the build did not package the patched source; do not publish it.",
      ],
    );
  }
  if (markerCount !== 1) {
    throw new PatchFailure(
      "E_PATCH_MARKER",
      `Expected exactly one ${PATCH_ID} marker, but found ${markerCount}.`,
      [],
      [
        "Inspect pid_matches_executable() for a partial or duplicated downstream modification.",
        "Rebuild from a clean upstream checkout before retrying.",
      ],
    );
  }

  const block = functionBlock(source, "pid_matches_executable");
  const requiredFragments = [
    'if ! pid_arg0_matches_path "$actual" "$expected"; then',
    '[ -n "${APPIMAGE:-}" ] || return 1',
    '[ -n "${APPDIR:-}" ] || return 1',
    'case "$expected" in',
    'case "${actual##*/}" in',
    'pid_environ_value "$pid" APPIMAGE',
    'pid_environ_value "$pid" APPDIR',
    'pid_matches_app_identity "$pid" || return 1',
    'pid_is_current_user "$pid" || return 1',
    '! pid_is_electron_helper "$pid"',
  ];

  const missing = requiredFragments.filter((fragment) => !block.includes(fragment));
  if (missing.length > 0) {
    throw new PatchFailure(
      "E_PATCH_POSTCONDITION",
      "The patch marker is present, but pid_matches_executable() is missing required behavior.",
      missing.map((fragment) => `Missing: ${fragment}`),
      [
        "Treat the target as partially patched and do not publish its AppImage.",
        "Rebuild from a clean checkout, then rerun the transform.",
      ],
    );
  }

  if (countOccurrences(block, EXACT_PATH_GUARD) !== 0) {
    throw new PatchFailure(
      "E_PATCH_POSTCONDITION",
      "The original unconditional exact-path guard is still present after patching.",
      [`Unexpected line: ${EXACT_PATH_GUARD.trim()}`],
      ["Rebuild from a clean checkout and rerun the transform."],
    );
  }

  const fallbackPosition = block.indexOf(PATCH_MARKER);
  const userCheckPosition = block.indexOf('pid_is_current_user "$pid" || return 1');
  if (fallbackPosition === -1 || userCheckPosition === -1 || fallbackPosition > userCheckPosition) {
    throw new PatchFailure(
      "E_PATCH_POSTCONDITION",
      "The AppImage fallback is not positioned before the common user and helper checks.",
      [],
      [
        "Do not publish this build.",
        "Review the transformed pid_matches_executable() control flow.",
      ],
    );
  }
}

function buildPatchedSource(source) {
  validateUnpatched(source);
  const patched = source.replace(EXACT_PATH_GUARD, APPIMAGE_AWARE_GUARD);
  validatePatched(patched);
  return patched;
}

function writeAtomically(target, source) {
  const temporary = `${target}.downstream-patch-${process.pid}`;
  const mode = statSync(target).mode;

  try {
    writeFileSync(temporary, source, "utf8");
    chmodSync(temporary, mode);
    renameSync(temporary, target);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function githubAnnotationEscape(value) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

export function formatFailure(error, target) {
  if (!(error instanceof PatchFailure)) {
    return [
      `::error title=AppImage launcher patch failed::${githubAnnotationEscape(error.message)}`,
      "",
      `[${PATCH_ID}] FAILED (E_UNEXPECTED)`,
      `Target: ${target}`,
      `Reason: ${error.stack ?? error.message}`,
      "",
      "Next steps:",
      "  - Check file permissions and the preceding workflow log.",
      "  - Do not publish the AppImage from this run.",
    ].join("\n");
  }

  const lines = [
    `::error title=AppImage launcher patch ${error.code}::${githubAnnotationEscape(error.message)}`,
    "",
    `[${PATCH_ID}] FAILED (${error.code})`,
    `Target: ${target}`,
    `Reason: ${error.message}`,
  ];
  if (error.evidence.length > 0) {
    lines.push("", "Evidence:");
    for (const item of error.evidence) {
      lines.push(`  - ${item}`);
    }
  }
  lines.push("", "Next steps:");
  for (const item of error.nextSteps) {
    lines.push(`  - ${item}`);
  }
  lines.push("", "No launcher file was written by this failed operation.");
  return lines.join("\n");
}

export function runPatch(mode, target) {
  const resolvedTarget = path.resolve(target);
  const source = readFileSync(resolvedTarget, "utf8");
  const markerCount = countOccurrences(source, PATCH_MARKER);

  if (mode === "verify") {
    validatePatched(source);
    return `[${PATCH_ID}] Verified: ${resolvedTarget}`;
  }

  if (markerCount > 0) {
    validatePatched(source);
    return `[${PATCH_ID}] Already applied and verified: ${resolvedTarget}`;
  }

  const patched = buildPatchedSource(source);
  if (mode === "check") {
    return `[${PATCH_ID}] Compatible: patch can be applied to ${resolvedTarget}`;
  }

  if (mode !== "apply") {
    throw new PatchFailure(
      "E_USAGE",
      `Unknown patch mode: ${mode}`,
      [],
      ["Use apply, check, or verify."],
    );
  }

  writeAtomically(resolvedTarget, patched);
  return `[${PATCH_ID}] Applied and verified: ${resolvedTarget}`;
}

function main() {
  let parsed = { mode: "apply", target: path.resolve(DEFAULT_TARGET) };

  try {
    parsed = parseArguments(process.argv.slice(2));
    console.log(runPatch(parsed.mode, parsed.target));
  } catch (error) {
    console.error(formatFailure(error, parsed.target));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
