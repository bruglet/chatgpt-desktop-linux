import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
import { setTimeout as delay } from "node:timers/promises";
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

function shellFunction(source, name) {
  const lines = source.split("\n");
  const start = lines.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `Missing shell function: ${name}`);

  const endOffset = lines.slice(start + 1).indexOf("}");
  assert.notEqual(endOffset, -1, `Unterminated shell function: ${name}`);
  return lines.slice(start, start + endOffset + 2).join("\n");
}

async function waitForCmdline(pid, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (cmdline.startsWith(expected)) {
        return;
      }
    } catch {
      // The process may still be replacing itself with sleep.
    }
    await delay(10);
  }
  assert.fail(`Process ${pid} did not acquire the expected command line`);
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

  const patched = readFileSync(launcher, "utf8");
  assert.match(patched, /downstream-appimage-stable-instance-v2/);
  assert.match(patched, /expected_relative=/);
  assert.match(patched, /\/tmp\/\.mount_/);
  assert.doesNotMatch(patched, /pid_environ_value "\$pid" APPIMAGE/);
  assert.doesNotMatch(patched, /pid_environ_value "\$pid" APPDIR/);
  const syntax = spawnSync("bash", ["-n", launcher], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  const verified = runPatch("verify", launcher);
  assert.match(verified, /Verified:/);

  const afterFirstApply = patched;
  const appliedAgain = runPatch("apply", launcher);
  assert.match(appliedAgain, /Already applied and verified/);
  assert.equal(readFileSync(launcher, "utf8"), afterFirstApply);
});

test("matches the same app across AppImage mounts without process environment", async (t) => {
  if (process.platform !== "linux") {
    t.skip("AppImage process matching is Linux-specific");
    return;
  }

  const launcher = fixture(t);
  runPatch("apply", launcher);
  const patched = readFileSync(launcher, "utf8");
  const oldArg0 =
    "/tmp/.mount_old/opt/codex-desktop/electron --no-sandbox --app-id=codex-desktop";
  const child = spawn(
    "bash",
    ["-c", 'exec -a "$1" sleep 30', "bash", oldArg0],
    {
      env: { PATH: process.env.PATH },
      stdio: "ignore",
    },
  );
  t.after(() => child.kill("SIGKILL"));
  await waitForCmdline(child.pid, oldArg0);

  const dependencies = [
    "pid_is_current_user",
    "pid_is_electron_helper",
    "pid_cmdline",
    "pid_cmdline_arg0",
    "pid_cmdline_arg0_path",
    "pid_arg0_matches_path",
    "pid_environ_lines",
    "pid_matches_app_identity",
    "pid_matches_executable",
  ];
  const harness = dependencies
    .map((name) => shellFunction(patched, name))
    .join("\n\n");
  const invocation = `${harness}
APPDIR=/tmp/.mount_new
CODEX_LINUX_APP_ID="$2"
pid_matches_executable "$1" "$APPDIR/opt/codex-desktop/electron"`;

  const sameApp = spawnSync(
    "bash",
    ["-c", invocation, "bash", String(child.pid), "codex-desktop"],
    { encoding: "utf8" },
  );
  assert.equal(sameApp.status, 0, sameApp.stderr);

  const differentApp = spawnSync(
    "bash",
    ["-c", invocation, "bash", String(child.pid), "different-app"],
    { encoding: "utf8" },
  );
  assert.notEqual(differentApp.status, 0);
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
