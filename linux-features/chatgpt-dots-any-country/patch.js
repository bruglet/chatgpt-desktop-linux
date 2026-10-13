"use strict";

const CONTRACTS = Object.freeze({
  landingRoute: [
    ["j?.tbo_config?.tbo_available==null", "!1"],
  ],
  appShared: [
    ["e.query.getData(iq,t)?.accounts[t]?.account.tbo_config?.tbo_available!==!0", "!1"],
    ["n?.accounts[t]?.account.tbo_config?.tbo_available===!0", "!0"],
  ],
  personalization: [
    ["_?.accounts[l]?.account.tbo_config?.tbo_available!==!0", "!1"],
    ["c?.accounts[i]?.account.tbo_config?.tbo_available!==!0", "!1"],
  ],
});

function applyContract(source, replacements, description) {
  const counts = replacements.map(([needle, , expected = 1]) => ({
    needle,
    expected,
    count: source.split(needle).length - 1,
  }));
  if (counts.every(({ count }) => count === 0)) {
    return source;
  }
  if (counts.some(({ count, expected }) => count !== expected)) {
    console.warn(`WARN: Could not prove the current ChatGPT Dots ${description} contract — skipping Dots patch`);
    return source;
  }

  return replacements.reduce(
    (patched, [needle, replacement]) => patched.replaceAll(needle, replacement),
    source,
  );
}

function applyDotsLandingRoutePatch(source) {
  return applyContract(source, CONTRACTS.landingRoute, "landing route");
}

function applyDotsAppSharedPatch(source) {
  return applyContract(source, CONTRACTS.appShared, "capability");
}

function applyDotsPersonalizationPatch(source) {
  return applyContract(source, CONTRACTS.personalization, "personalization");
}

const descriptors = [
  {
    id: "dots-landing-route",
    phase: "webview-asset",
    order: 20_900,
    ciPolicy: "optional",
    pattern: /^landing-route-[^.]+\.js$/,
    assetMatch: (source) => CONTRACTS.landingRoute.every(([needle]) => source.includes(needle)),
    missingDescription: "ChatGPT Dots landing route bundle",
    skipDescription: "ChatGPT Dots landing route patch",
    apply: applyDotsLandingRoutePatch,
  },
  {
    id: "dots-app-shared-capability",
    phase: "webview-asset",
    order: 20_901,
    ciPolicy: "optional",
    pattern: /^app-shared-[^.]+\.js$/,
    assetMatch: (source) => CONTRACTS.appShared.every(([needle]) => source.includes(needle)),
    missingDescription: "ChatGPT Dots shared capability bundle",
    skipDescription: "ChatGPT Dots capability patch",
    apply: applyDotsAppSharedPatch,
  },
  {
    id: "dots-personalization-capability",
    phase: "webview-asset",
    order: 20_902,
    ciPolicy: "optional",
    pattern: /^personalization-settings-[^.]+\.js$/,
    assetMatch: (source) => CONTRACTS.personalization.every(([needle]) => source.includes(needle)),
    missingDescription: "ChatGPT Dots personalization bundle",
    skipDescription: "ChatGPT Dots personalization patch",
    apply: applyDotsPersonalizationPatch,
  },
];

module.exports = {
  CONTRACTS,
  applyDotsAppSharedPatch,
  applyDotsLandingRoutePatch,
  applyDotsPersonalizationPatch,
  descriptors,
};
