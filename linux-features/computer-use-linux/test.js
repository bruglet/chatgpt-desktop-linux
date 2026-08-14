"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const manifest = require("./feature.json");
const descriptors = require("./patch.js");

test("computer-use-linux is opt-in and owns the eight Linux descriptors", () => {
  assert.equal(manifest.defaultEnabled, false);
  assert.deepEqual(
    descriptors.map(({ id }) => id),
    [
      "avatar-cursor",
      "ui-feature",
      "plugin-gate",
      "native-desktop-apps",
      "ui-availability",
      "host-platform",
      "install-flow",
      "nix-staging-permissions",
    ],
  );
});

const STAGING_COPY_FIXTURE = `async function Mne(source,destination){if(S.default.platform===\`darwin\`){await ditto(\`ditto\`,[source,destination]);return}if(S.default.platform!==\`win32\`){await y.default.cp(source,destination,{recursive:!0,verbatimSymlinks:!0});return}let{copyDirectoryAllowDecryptedDestinationOnEncryptionFailure:copy}=await Promise.resolve().then(()=>require("./windows-file-copy-Bw9CB6bJ.js"));await copy({copy:()=>y.default.cp(source,destination,{recursive:!0,verbatimSymlinks:!0}),destination,source})}
async function copyPlugins(source,destination){const staging=\`openai-bundled.staging-\${randomUUID()}\`;await Mne(source,destination);await transform({pluginRoot:destination});return staging}`;

function stagingFs({ copyError = null, writable = false } = {}) {
  const nodes = new Map([
    ["destination", { kind: "directory", mode: writable ? 0o755 : 0o555, entries: ["nested", "manifest", "link", "socket"] }],
    ["destination/nested", { kind: "directory", mode: writable ? 0o755 : 0o555, entries: [] }],
    ["destination/manifest", { kind: "file", mode: writable ? 0o644 : 0o444 }],
    ["destination/link", { kind: "symlink", mode: 0o777 }],
    ["destination/socket", { kind: "special", mode: 0o600 }],
  ]);
  const chmodCalls = [];
  return {
    chmodCalls,
    nodes,
    fs: {
      async cp() {
        if (copyError != null) throw copyError;
      },
      async lstat(target) {
        const node = nodes.get(target);
        if (node == null) {
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        }
        return {
          mode: node.mode,
          isDirectory: () => node.kind === "directory",
          isFile: () => node.kind === "file",
          isSymbolicLink: () => node.kind === "symlink",
        };
      },
      async chmod(target, mode) {
        chmodCalls.push(target);
        nodes.get(target).mode = mode;
      },
      async readdir(target) {
        return [...nodes.get(target).entries];
      },
    },
  };
}

function materializeStagingCopy(source, fsApi) {
  const context = {
    randomUUID: () => "uuid",
    S: { default: { platform: "linux" } },
    transform: async () => {},
    y: { default: fsApi },
  };
  require("node:vm").runInNewContext(`${source};globalThis.copy=copyPlugins;`, context);
  return context.copy;
}

test("computer-use-linux makes copied Nix staging nodes owner-writable", async () => {
  const descriptor = descriptors.find(({ id }) => id === "nix-staging-permissions");
  assert.ok(descriptor);
  const patched = descriptor.apply(STAGING_COPY_FIXTURE);
  const { fs: fsApi, nodes } = stagingFs();

  await materializeStagingCopy(patched, fsApi)("source", "destination");

  assert.equal(nodes.get("destination").mode, 0o755);
  assert.equal(nodes.get("destination/nested").mode, 0o755);
  assert.equal(nodes.get("destination/manifest").mode, 0o644);
  assert.equal(nodes.get("destination/link").mode, 0o777);
  assert.equal(nodes.get("destination/socket").mode, 0o600);
});

test("computer-use-linux repairs partial Nix staging copies for cleanup", async () => {
  const descriptor = descriptors.find(({ id }) => id === "nix-staging-permissions");
  const patched = descriptor.apply(STAGING_COPY_FIXTURE);
  const copyError = new Error("copy failed");
  const { fs: fsApi, nodes } = stagingFs({ copyError });

  await assert.rejects(materializeStagingCopy(patched, fsApi)("source", "destination"), copyError);
  assert.equal(nodes.get("destination").mode, 0o755);
  assert.equal(nodes.get("destination/nested").mode, 0o755);
  assert.equal(nodes.get("destination/manifest").mode, 0o644);
});

test("computer-use-linux leaves already-writable staging nodes unchanged", async () => {
  const descriptor = descriptors.find(({ id }) => id === "nix-staging-permissions");
  const patched = descriptor.apply(STAGING_COPY_FIXTURE);
  const { chmodCalls, fs: fsApi } = stagingFs({ writable: true });

  await materializeStagingCopy(patched, fsApi)("source", "destination");

  assert.deepEqual(chmodCalls, []);
});

test("computer-use-linux Nix staging patch is unique, fail-closed, and idempotent", () => {
  const descriptor = descriptors.find(({ id }) => id === "nix-staging-permissions");
  const patched = descriptor.apply(STAGING_COPY_FIXTURE);

  assert.equal(descriptor.apply(patched), patched);
  assert.throws(
    () => descriptor.apply(STAGING_COPY_FIXTURE.replace("platform!==`win32`", "platform===`linux`")),
    /matched 0 times/,
  );
  assert.throws(
    () => descriptor.apply(`${STAGING_COPY_FIXTURE}\n${STAGING_COPY_FIXTURE}`),
    /matched 2 times/,
  );
  assert.throws(
    () => descriptor.apply(STAGING_COPY_FIXTURE.replace("await Mne(source,destination)", "await otherCopy(source,destination)")),
    /staging call matched 0 times/,
  );

  const withUnrelatedCaller = `${STAGING_COPY_FIXTURE}\nasync function unrelated(source,destination){await Mne(source,destination)}`;
  const narrowlyPatched = descriptor.apply(withUnrelatedCaller);
  assert.match(narrowlyPatched, /try\{await Mne\(source,destination\)\}finally/);
  assert.match(narrowlyPatched, /async function unrelated\(source,destination\)\{await Mne\(source,destination\)\}/);
  assert.match(
    narrowlyPatched,
    /platform!==`win32`\)\{await y\.default\.cp\(source,destination,\{recursive:!0,verbatimSymlinks:!0\}\);return}/,
  );
});

test("computer-use-linux repairs real fs.cp modes before plugin metadata rewriting", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "computer-use-linux-nix-copy-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  const sourceMetadata = path.join(source, ".codex-plugin");
  const destinationManifest = path.join(destination, ".codex-plugin", "plugin.json");
  t.after(() => {
    for (const directory of [sourceMetadata, source]) {
      if (fs.existsSync(directory)) fs.chmodSync(directory, 0o755);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  fs.mkdirSync(sourceMetadata, { recursive: true });
  fs.writeFileSync(path.join(sourceMetadata, "plugin.json"), "{}\n");
  fs.chmodSync(path.join(sourceMetadata, "plugin.json"), 0o444);
  fs.chmodSync(sourceMetadata, 0o555);
  fs.chmodSync(source, 0o555);

  const descriptor = descriptors.find(({ id }) => id === "nix-staging-permissions");
  const patched = descriptor.apply(STAGING_COPY_FIXTURE);
  await materializeStagingCopy(patched, fs.promises)(source, destination);

  assert.equal(fs.statSync(destination).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.dirname(destinationManifest)).mode & 0o777, 0o755);
  assert.equal(fs.statSync(destinationManifest).mode & 0o777, 0o644);
  await fs.promises.writeFile(destinationManifest, '{"rewritten":true}\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(destinationManifest, "utf8")), { rewritten: true });
});

test("computer-use-linux staging consumes release artifacts without invoking Cargo", () => {
  const stage = fs.readFileSync(path.join(__dirname, "stage.sh"), "utf8");
  assert.doesNotMatch(stage, /cargo\s+(?:build|install)/);
  assert.match(stage, /target\/release\/codex-computer-use-linux/);
});

test("computer-use-linux staging registers the bundled plugin idempotently", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "computer-use-linux-stage-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const installDir = path.join(workspace, "app");
  const releaseDir = path.join(workspace, "target", "release");
  const marketplacePath = path.join(
    installDir,
    "resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
  );
  fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
  fs.writeFileSync(
    marketplacePath,
    `${JSON.stringify({ plugins: [{ name: "browser", source: { source: "local", path: "./plugins/browser" } }] })}\n`,
  );
  fs.mkdirSync(releaseDir, { recursive: true });
  for (const binary of ["codex-computer-use-linux", "codex-computer-use-cosmic"]) {
    const binaryPath = path.join(releaseDir, binary);
    fs.writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }

  const env = {
    ...process.env,
    SCRIPT_DIR: workspace,
    INSTALL_DIR: installDir,
    CODEX_COMPUTER_USE_BINARY_SOURCE: path.join(releaseDir, "codex-computer-use-linux"),
    CODEX_COMPUTER_USE_COSMIC_BINARY_SOURCE: path.join(releaseDir, "codex-computer-use-cosmic"),
  };
  fs.mkdirSync(path.join(workspace, "plugins/openai-bundled/plugins"), { recursive: true });
  fs.cpSync(
    path.resolve(__dirname, "../../plugins/openai-bundled/plugins/computer-use"),
    path.join(workspace, "plugins/openai-bundled/plugins/computer-use"),
    { recursive: true },
  );

  execFileSync("bash", [path.join(__dirname, "stage.sh")], { env });
  execFileSync("bash", [path.join(__dirname, "stage.sh")], { env });

  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
  assert.equal(marketplace.plugins.filter(({ name }) => name === "computer-use").length, 1);
  assert.ok(marketplace.plugins.some(({ name }) => name === "browser"));
  assert.deepEqual(
    marketplace.plugins.find(({ name }) => name === "computer-use"),
    {
      name: "computer-use",
      source: { source: "local", path: "./plugins/computer-use" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    },
  );
  assert.equal(
    fs.existsSync(
      path.join(
        installDir,
        "resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux",
      ),
    ),
    true,
  );
});
