import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatFailure,
  runPatch,
} from "./apply-appimage-single-instance-fix.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const upstreamLauncher = path.join(
  repositoryRoot,
  "launcher",
  "start.sh.template",
);

function fixture(t) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "appimage-single-instance-patch-"),
  );
  const launcher = path.join(directory, "start.sh.template");
  copyFileSync(upstreamLauncher, launcher);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return launcher;
}

function captureFailure(operation, target) {
  try {
    operation();
  } catch (error) {
    return formatFailure(error, target);
  }
  assert.fail("Expected operation to fail");
}

test("checks compatibility without writing", (t) => {
  const launcher = fixture(t);
  const before = readFileSync(launcher, "utf8");
  const result = runPatch("check", launcher);

  assert.match(result, /Compatible: patch can be applied/);
  assert.equal(readFileSync(launcher, "utf8"), before);
});

test("explains when verification targets an unpatched launcher", (t) => {
  const launcher = fixture(t);
  const result = captureFailure(() => runPatch("verify", launcher), launcher);

  assert.match(result, /E_PATCH_NOT_APPLIED/);
  assert.match(result, /target does not contain/);
  assert.match(result, /run --check and then --apply/);
  assert.match(result, /No launcher file was written/);
});

test("applies, verifies, and remains idempotent", (t) => {
  const launcher = fixture(t);

  const applied = runPatch("apply", launcher);
  assert.match(applied, /Applied and verified/);

  const verified = runPatch("verify", launcher);
  assert.match(verified, /Verified:/);

  const afterFirstApply = readFileSync(launcher, "utf8");
  const appliedAgain = runPatch("apply", launcher);
  assert.match(appliedAgain, /Already applied and verified/);
  assert.equal(readFileSync(launcher, "utf8"), afterFirstApply);
});

test("reports exact-path guard drift with remediation", (t) => {
  const launcher = fixture(t);
  const source = readFileSync(launcher, "utf8").replace(
    '    pid_arg0_matches_path "$actual" "$expected" || return 1',
    '    pid_arg0_matches_path "$actual" "$expected" || return 2',
  );
  writeFileSync(launcher, source);

  const result = captureFailure(() => runPatch("apply", launcher), launcher);
  assert.match(result, /E_EXACT_PATH_GUARD_DRIFT/);
  assert.match(
    result,
    /Review upstream's current pid_matches_executable\(\) implementation/,
  );
  assert.match(result, /No launcher file was written/);
  assert.equal(readFileSync(launcher, "utf8"), source);
});

test("reports a missing upstream dependency by name", (t) => {
  const launcher = fixture(t);
  const source = readFileSync(launcher, "utf8").replace(
    "pid_matches_app_identity() {",
    "pid_matches_application_identity() {",
  );
  writeFileSync(launcher, source);

  const result = captureFailure(() => runPatch("check", launcher), launcher);
  assert.match(result, /E_FUNCTION_SHAPE/);
  assert.match(
    result,
    /Expected exactly one pid_matches_app_identity\(\) function/,
  );
  assert.match(result, /Do not force the patch/);
  assert.equal(readFileSync(launcher, "utf8"), source);
});
