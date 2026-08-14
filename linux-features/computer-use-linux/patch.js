"use strict";

const { mainBundlePatch, webviewAssetPatch } = require("../../scripts/patches/descriptor.js");
const {
  applyLinuxComputerUseAvatarCursorBridgePatch,
  applyLinuxComputerUseFeaturePatch,
  applyLinuxComputerUseHostPlatformPatch,
  applyLinuxComputerUseInstallFlowPatch,
  applyLinuxComputerUsePluginGatePatch,
  applyLinuxComputerUseRendererAvailabilityPatch,
  applyLinuxNativeDesktopAppsHandlerPatch,
  matchesLinuxComputerUseHostPlatformContract,
  matchesLinuxComputerUseInstallFlowContract,
} = require("../../scripts/patches/impl/computer-use.js");

const NIX_STAGING_PERMISSIONS_MARKER = "codex-linux-computer-use-nix-staging-permissions-v1";
const IDENT = "[A-Za-z_$][\\w$]*";

const NIX_STAGING_PERMISSIONS_HELPER = `/* ${NIX_STAGING_PERMISSIONS_MARKER} */
async function codexLinuxComputerUseMakeStagingCopyWritable(fs,destination){
  let stat;
  try{stat=await fs.lstat(destination)}catch(error){if(error?.code===\`ENOENT\`)return;throw error}
  if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))return;
  if((stat.mode&0o200)===0)await fs.chmod(destination,stat.mode|0o200);
  if(!stat.isDirectory())return;
  for(const entry of await fs.readdir(destination)){
    await codexLinuxComputerUseMakeStagingCopyWritable(fs,\`\${destination}/\${entry}\`);
  }
}
`;

function applyLinuxComputerUseNixStagingPermissionsPatch(source) {
  if (source.includes(NIX_STAGING_PERMISSIONS_MARKER)) return source;
  if (!source.includes(".staging-${")) {
    throw new Error("Linux Computer Use Nix staging patch could not find the bundled marketplace staging contract");
  }

  const copyPattern = new RegExp(
    `await (${IDENT})\\.default\\.cp\\((${IDENT}),(${IDENT}),\\{recursive:!0,verbatimSymlinks:!0\\}\\)` +
      "(?=;return\\}let\\{copyDirectoryAllowDecryptedDestinationOnEncryptionFailure:)",
    "g",
  );
  const matches = [...source.matchAll(copyPattern)].filter((match) => {
    const prefix = source.slice(Math.max(0, match.index - 160), match.index);
    const suffix = source.slice(match.index + match[0].length, match.index + match[0].length + 420);
    return prefix.includes("platform!==`win32`") && suffix.includes("windows-file-copy-");
  });
  if (matches.length !== 1) {
    throw new Error(`Linux Computer Use Nix staging copy contract matched ${matches.length} times`);
  }

  const match = matches[0];
  const [, fsName] = match;
  const copyFunctionPrefix = source.slice(0, match.index);
  const copyFunctionMatch = [...copyFunctionPrefix.matchAll(new RegExp(`async function (${IDENT})\\([^)]*\\)\\{`, "g"))].at(-1);
  if (copyFunctionMatch == null) {
    throw new Error("Linux Computer Use Nix staging patch could not resolve the copy helper name");
  }
  const copyFunctionName = copyFunctionMatch[1];
  const stagingCalls = [...source.matchAll(new RegExp(`await ${copyFunctionName}\\((${IDENT}),(${IDENT})\\)`, "g"))]
    .filter((call) => {
      const prefix = source.slice(Math.max(0, call.index - 3_000), call.index);
      const suffix = source.slice(call.index + call[0].length, call.index + call[0].length + 1_200);
      return prefix.includes(".staging-${") && suffix.includes(`pluginRoot:${call[2]}`);
    });
  if (stagingCalls.length !== 1) {
    throw new Error(`Linux Computer Use bundled marketplace staging call matched ${stagingCalls.length} times`);
  }

  const stagingCall = stagingCalls[0];
  const stagingDestinationName = stagingCall[2];
  const replacement =
    `try{${stagingCall[0]}}finally{` +
    `await codexLinuxComputerUseMakeStagingCopyWritable(${fsName}.default,${stagingDestinationName})}`;
  return `${NIX_STAGING_PERMISSIONS_HELPER}${source.slice(0, stagingCall.index)}${replacement}${source.slice(stagingCall.index + stagingCall[0].length)}`;
}

module.exports = [
  mainBundlePatch({
    id: "avatar-cursor",
    phase: "main-bundle",
    order: 20_100,
    ciPolicy: "optional",
    apply: applyLinuxComputerUseAvatarCursorBridgePatch,
  }),
  mainBundlePatch({
    id: "ui-feature",
    phase: "main-bundle",
    order: 20_110,
    ciPolicy: "optional",
    apply: applyLinuxComputerUseFeaturePatch,
  }),
  mainBundlePatch({
    id: "plugin-gate",
    phase: "main-bundle",
    order: 20_120,
    ciPolicy: "optional",
    apply: applyLinuxComputerUsePluginGatePatch,
  }),
  mainBundlePatch({
    id: "native-desktop-apps",
    phase: "main-bundle",
    order: 20_130,
    ciPolicy: "optional",
    apply: applyLinuxNativeDesktopAppsHandlerPatch,
  }),
  webviewAssetPatch({
    id: "ui-availability",
    phase: "webview-asset",
    order: 20_140,
    ciPolicy: "optional",
    pattern: /^computer-use-settings-[^.]+\.js$/,
    missingDescription: "Computer Use availability bundle",
    skipDescription: "Linux Computer Use UI availability patch",
    apply: applyLinuxComputerUseRendererAvailabilityPatch,
  }),
  webviewAssetPatch({
    id: "host-platform",
    phase: "webview-asset",
    order: 20_150,
    ciPolicy: "optional",
    pattern: /^app-initial-[^.]+\.js$/,
    assetMatch: matchesLinuxComputerUseHostPlatformContract,
    missingDescription: "current Computer Use host-platform app-initial contract",
    skipDescription: "Linux Computer Use host-platform patch",
    apply: applyLinuxComputerUseHostPlatformPatch,
  }),
  webviewAssetPatch({
    id: "install-flow",
    phase: "webview-asset",
    order: 20_160,
    ciPolicy: "optional",
    pattern: /^app-initial-[^.]+\.js$/,
    assetMatch: matchesLinuxComputerUseInstallFlowContract,
    missingDescription: "current Computer Use install flow app-initial contract",
    skipDescription: "Linux Computer Use install flow patch",
    apply: applyLinuxComputerUseInstallFlowPatch,
  }),
  mainBundlePatch({
    id: "nix-staging-permissions",
    phase: "main-bundle",
    order: 20_170,
    ciPolicy: "optional",
    apply: applyLinuxComputerUseNixStagingPermissionsPatch,
  }),
];
