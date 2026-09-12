#!/usr/bin/env node
"use strict";
const { readPatchReport, validatePatchReport } = require("../../scripts/lib/patch-validation.js");
const { SUCCESS_STATUSES } = require("../../scripts/lib/patch-report.js");
const { loadLinuxFeaturePatchDescriptors, enabledLinuxFeatureIds } = require("../../scripts/lib/linux-features.js");
const report = readPatchReport(process.argv[2]);
const descriptors = loadLinuxFeaturePatchDescriptors();
const errors = validatePatchReport(report, "upstream-build", {
  requiredEnabledFeatures: enabledLinuxFeatureIds(),
  requiredSuccessfulPatches: descriptors.map(descriptor => descriptor.name ?? descriptor.id),
});
// Optional descriptors can drift without failing the upstream builder. A cask
// release must actually provide every selected ASAR feature.
for (const patch of report.patches) {
  if (!SUCCESS_STATUSES.has(patch.status)) errors.push(`${patch.name}: ${patch.status}`);
}
if (descriptors.length > 0 && report.patches.length === 0) {
  errors.push("Enabled ASAR features produced no patch results");
}
if (errors.length) throw new Error(errors.join("\n"));
