import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const uuid = "global-dictation-gnome@chatgpt-community.local";
const marker = ".chatgpt-community-owned.sha256";
const sources = ["config.json", "extension.js", "metadata.json"];
const files = [...sources, marker];
const uid = process.getuid();

function stat(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function trustedAncestors(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    const info = stat(current);
    if (!info?.isDirectory() || (info.uid !== uid && info.uid !== 0) || (info.mode & 0o022)) return false;
    if (current === "/") return true;
  }
}

function managedHelper(directory, caskRoot) {
  const info = stat(directory);
  if (!info?.isDirectory() || info.uid !== uid || (info.mode & 0o022)) return undefined;
  const entries = fs.readdirSync(directory);
  if (entries.length !== files.length || !files.every((file) => entries.includes(file))) return undefined;
  for (const file of files) {
    const entry = stat(path.join(directory, file));
    if (!entry?.isFile() || entry.uid !== uid || (entry.mode & 0o022) || entry.nlink !== 1) return undefined;
  }

  const contents = sources.map((file) => fs.readFileSync(path.join(directory, file)));
  const hashes = contents.map((data, index) => `${createHash("sha256").update(data).digest("hex")}  ${sources[index]}\n`);
  const ownership = `ChatGPT Community managed extension v1: ${uuid}\n${hashes.join("")}`;
  if (fs.readFileSync(path.join(directory, marker), "utf8") !== ownership) return undefined;

  let helperPath;
  try {
    helperPath = JSON.parse(contents[0])?.helperPath;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (typeof helperPath !== "string" || !path.isAbsolute(helperPath) || path.normalize(helperPath) !== helperPath) {
    return undefined;
  }
  const relative = path.relative(caskRoot, helperPath);
  if (!/^\d+(?:\.\d+)+,\d+\/prepared\/app\/resources\/native\/codex-global-dictation-linux$/.test(relative)) {
    return undefined;
  }
  return helperPath;
}

function chatGptRunning() {
  for (const pid of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(pid) || stat(`/proc/${pid}`)?.uid !== uid) continue;
    try {
      if (/^\d+ \(ChatGPT\) [^ZX] /.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"))) return true;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
    }
  }
  return false;
}

function removeCompanion(directory, caskRoot, helperPath) {
  if (chatGptRunning()) throw new Error("Close ChatGPT before cleaning up integrations.");
  const parent = path.dirname(directory);
  const lock = path.join(parent, `.${uuid}.lock`);
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    if (managedHelper(directory, caskRoot) !== helperPath) throw new Error("Companion changed before cleanup.");
    const scratch = fs.mkdtempSync(path.join(parent, `.${uuid}.cleanup.`));
    const moved = path.join(scratch, uuid);
    try {
      fs.renameSync(directory, moved);
      if (managedHelper(moved, caskRoot) !== helperPath) {
        if (!stat(directory)) fs.renameSync(moved, directory);
        throw new Error("Companion changed during cleanup.");
      }
      for (const file of files) fs.unlinkSync(path.join(moved, file));
      fs.rmdirSync(moved);
    } finally {
      if (stat(moved)) {
        console.error(`Inspect the preserved companion at ${moved}`);
      } else {
        fs.rmdirSync(scratch);
      }
    }
  } finally {
    fs.rmdirSync(lock);
  }
}

function report(name, file) {
  console.log(`${name}: ${stat(file) ? "present" : "absent"} at ${file}`);
}

function main(appDir, operation = "preview") {
  const caskRoot = path.resolve(fs.realpathSync(appDir), "../../..");
  if (operation === "retired" && !caskRoot.endsWith("/Caskroom/chatgpt-community")) return;
  if (!["preview", "apply", "retired"].includes(operation) || !caskRoot.endsWith("/Caskroom/chatgpt-community")) {
    throw new Error("Run integration cleanup from the installed ChatGPT Community cask.");
  }
  if (operation === "retired") {
    const release = JSON.parse(fs.readFileSync(path.join(appDir, ".codex-linux/homebrew-release.json"), "utf8"));
    const enabled = release.features?.enabled;
    if (!Array.isArray(enabled)) throw new Error("Missing enabled features in the Homebrew release manifest.");
    if (enabled.includes("global-dictation-gnome")) return;
  }
  const home = os.homedir();
  const realHome = fs.realpathSync(home);
  // Accept the physical home path on systems such as Bazzite. Check every descendant for symlinks.
  const configuredData = process.env.XDG_DATA_HOME || path.join(home, ".local/share");
  const data = configuredData.startsWith(`${home}/`) ? realHome + configuredData.slice(home.length) : configuredData;
  if (!path.isAbsolute(data) || path.normalize(data) !== data || /[\x00-\x1f]/.test(data)) {
    throw new Error("XDG_DATA_HOME must be a normalized absolute path.");
  }

  if (operation !== "retired") {
    const codex = process.env.CODEX_HOME || path.join(home, ".codex");
    const chrome = process.env.CODEX_FLATPAK_CHROME_ROOT || path.join(home, ".var/app/com.google.Chrome");
    const state = process.env.XDG_STATE_HOME || path.join(home, ".local/state");
    report("Agent Workspaces skill (shared profile)", path.join(codex, "skills/agent-workspace-linux/SKILL.md"));
    report("Computer Use GNOME extension (shared)", path.join(data, "gnome-shell/extensions/codex-window-control@openai.com"));
    report("Flatpak Chrome native manifest", path.join(chrome, "config/google-chrome/NativeMessagingHosts/com.openai.codexextension.json"));
    report("Flatpak Chrome bridge recovery record", path.join(state, "codex-desktop/flatpak-chrome-native-messaging/original-manifest.json"));
  }

  const directory = path.join(data, "gnome-shell/extensions", uuid);
  if (!stat(directory)) {
    if (operation !== "retired") console.log(`GNOME dictation companion: absent at ${directory}`);
    return;
  }

  const helperPath = uid !== 0 && trustedAncestors(path.dirname(directory)) && managedHelper(directory, caskRoot);
  if (!helperPath) {
    console.log(`GNOME dictation companion: preserving unverified files at ${directory}`);
    return;
  }
  if (operation === "preview") {
    console.log(`GNOME dictation companion: verified cask-owned files at ${directory}`);
    return;
  }
  const ownerVersion = path.relative(caskRoot, helperPath).split(path.sep, 1)[0];
  if (operation === "retired" && stat(path.join(caskRoot, ownerVersion))) return;
  removeCompanion(directory, caskRoot, helperPath);
  console.log(`Removed verified GNOME dictation companion at ${directory}`);
}

try {
  main(...process.argv.slice(2));
} catch (error) {
  console.error(`ChatGPT Community integration cleanup: ${error.message}`);
  process.exitCode = 1;
}
