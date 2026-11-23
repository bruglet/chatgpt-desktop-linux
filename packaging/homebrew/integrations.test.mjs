import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const uuid = "global-dictation-gnome@chatgpt-community.local";
const marker = ".chatgpt-community-owned.sha256";
const sources = ["config.json", "extension.js", "metadata.json"];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".homebrew-integration-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "Caskroom/chatgpt-community/26.1117.41037,5/prepared/app");
  const data = path.join(root, "desktop data");
  const codex = path.join(root, "shared profile");
  const chrome = path.join(root, "Chrome Flatpak");
  const directory = path.join(data, "gnome-shell/extensions", uuid);
  const packagedHelper = path.join(app, "resources/native/codex-global-dictation-linux");
  for (const target of [".codex-linux", "resources/cua_node/bin", "resources/native"]) {
    fs.mkdirSync(path.join(app, target), { recursive: true });
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(new URL("./launch.sh", import.meta.url), path.join(app, "start.sh"));
  fs.copyFileSync(new URL("./integrations.mjs", import.meta.url), path.join(app, ".codex-linux/homebrew-integrations.mjs"));
  fs.writeFileSync(path.join(app, "start-real.sh"), '#!/bin/bash\nprintf "Launched: %s\\n" "$@"\n', { mode: 0o755 });
  fs.symlinkSync(process.execPath, path.join(app, "resources/cua_node/bin/node"));
  fs.writeFileSync(path.join(app, ".codex-linux/homebrew-release.json"), '{"features":{"enabled":[]}}');
  fs.writeFileSync(packagedHelper, "");

  function installCopy(helperPath = packagedHelper) {
    fs.writeFileSync(path.join(directory, "config.json"), JSON.stringify({ helperPath }) + "\n");
    fs.writeFileSync(path.join(directory, "extension.js"), "// extension\n");
    fs.writeFileSync(path.join(directory, "metadata.json"), "{}\n");
    const sums = sources.map((file) => {
      const digest = createHash("sha256").update(fs.readFileSync(path.join(directory, file))).digest("hex");
      return `${digest}  ${file}\n`;
    }).join("");
    fs.writeFileSync(path.join(directory, marker), `ChatGPT Community managed extension v1: ${uuid}\n${sums}`);
  }

  function launch(...args) {
    return spawnSync("bash", [path.join(app, "start.sh"), ...args], {
      env: { ...process.env, XDG_DATA_HOME: data, CODEX_HOME: codex, CODEX_FLATPAK_CHROME_ROOT: chrome },
      encoding: "utf8",
    });
  }
  installCopy();
  return { root, app, data, codex, chrome, directory, packagedHelper, installCopy, launch };
}

test("preview is read-only, then explicit cleanup removes only the verified companion", (t) => {
  const { directory, codex, chrome, launch } = fixture(t);
  const skill = path.join(codex, "skills/agent-workspace-linux/SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, "user edits");
  const manifest = path.join(chrome, "config/google-chrome/NativeMessagingHosts/com.openai.codexextension.json");
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, "existing Chrome connection");
  const preview = launch("--cleanup-integrations");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /verified cask-owned files/);
  assert.match(preview.stdout, /Agent Workspaces skill \(shared profile\): present/);
  assert.match(preview.stdout, /Flatpak Chrome native manifest: present/);
  assert.ok(fs.existsSync(directory));

  const cleanup = launch("--cleanup-integrations", "--apply");
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.match(cleanup.stdout, /Removed verified GNOME dictation companion/);
  assert.equal(fs.existsSync(directory), false);
  assert.equal(fs.readFileSync(skill, "utf8"), "user edits");
  assert.equal(fs.readFileSync(manifest, "utf8"), "existing Chrome connection");
  assert.deepEqual(fs.readdirSync(path.dirname(directory)), []);
  assert.equal(launch("--cleanup-integrations", "--apply").status, 0);
});

for (const [name, replace] of [
  ["edited file", ({ directory }) => fs.appendFileSync(path.join(directory, "extension.js"), "// edits")],
  ["foreign installation", ({ installCopy }) => installCopy("/opt/codex-desktop/resources/native/codex-global-dictation-linux")],
  ["additional file", ({ directory }) => fs.writeFileSync(path.join(directory, "user-data"), "keep")],
  ["symlinked file", ({ directory, root }) => {
    const target = path.join(root, "outside");
    fs.renameSync(path.join(directory, "extension.js"), target);
    fs.symlinkSync(target, path.join(directory, "extension.js"));
  }],
  ["symlinked ancestor", ({ data, root }) => {
    fs.renameSync(path.join(data, "gnome-shell"), path.join(root, "other"));
    fs.symlinkSync(path.join(root, "other"), path.join(data, "gnome-shell"));
  }],
]) {
  test(`cleanup preserves a companion with this change: ${name}`, (t) => {
    const state = fixture(t);
    replace(state);
    const result = state.launch("--cleanup-integrations", "--apply");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /preserving unverified files/);
    assert.ok(fs.existsSync(state.directory));
  });
}

test("launch removes the retired companion only when its previous cask version is gone", (t) => {
  const { app, directory, packagedHelper, installCopy, launch } = fixture(t);
  assert.equal(launch("codex://test").stdout, "Launched: codex://test\n");
  assert.ok(fs.existsSync(directory));
  const previousHelper = packagedHelper.replace("26.1117.41037,5", "26.1117.41037,4");
  installCopy(previousHelper);

  const installedFeature = path.join(app, ".codex-linux/features/global-dictation-gnome/extension");
  fs.mkdirSync(installedFeature, { recursive: true });
  assert.equal(launch("codex://test").status, 0);
  assert.ok(fs.existsSync(directory));
  fs.rmdirSync(installedFeature);
  const release = path.join(app, ".codex-linux/homebrew-release.json");
  fs.writeFileSync(release, '{"features":{"enabled":["global-dictation-gnome"]}}');
  assert.equal(launch("codex://test").status, 0);
  assert.ok(fs.existsSync(directory));
  fs.writeFileSync(release, '{"features":{"enabled":[]}}');
  assert.equal(launch("--diagnose").status, 0);
  assert.ok(fs.existsSync(directory));

  const retired = launch("codex://test");
  assert.equal(retired.status, 0, retired.stderr);
  assert.equal(retired.stdout, "Launched: codex://test\n");
  assert.match(retired.stderr, /Removed verified GNOME dictation companion/);
  assert.equal(fs.existsSync(directory), false);
});

test("launching through a symlinked cask prefix uses the physical ownership path", (t) => {
  const { root, app, data } = fixture(t);
  const alias = path.join(root, "linked-prefix");
  fs.symlinkSync(path.join(root, "Caskroom"), alias);
  const launcher = path.join(alias, path.relative(path.join(root, "Caskroom"), app), "start.sh");
  const preview = spawnSync("bash", [launcher, "--cleanup-integrations"], {
    env: { ...process.env, XDG_DATA_HOME: data },
    encoding: "utf8",
  });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /verified cask-owned files/);
});

test("cleanup respects the existing installer lock", (t) => {
  const { directory, launch } = fixture(t);
  const lock = path.join(path.dirname(directory), `.${uuid}.lock`);
  fs.mkdirSync(lock);
  const result = launch("--cleanup-integrations", "--apply");
  assert.equal(result.status, 1);
  assert.ok(fs.existsSync(directory));
  assert.ok(fs.existsSync(lock));
});

test("cleanup refuses while ChatGPT is running", async (t) => {
  const { directory, root, launch } = fixture(t);
  const executable = path.join(root, "ChatGPT");
  fs.symlinkSync("/bin/sleep", executable);
  const child = spawn(executable, ["10"]);
  t.after(() => child.kill());
  await new Promise((resolve, reject) => child.once("spawn", resolve).once("error", reject));
  const result = launch("--cleanup-integrations", "--apply");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Close ChatGPT/);
  assert.ok(fs.existsSync(directory));
});
