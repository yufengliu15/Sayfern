// electron-builder afterPack hook (electron-builder.yml `afterPack`): runs once the .app is assembled,
// before it is signed and before the .dmg is made.
// macOS: strips extended attributes (quarantine, Finder info, resource forks) from the whole bundle.
// Left in place, codesign refuses the bundle ("resource fork, Finder information, or similar detritus
// not allowed") and the shipped app can carry attributes from the build machine.
// CommonJS on purpose: package.json is "type": "module" and electron-builder require()s hooks.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

/** @param {import("electron-builder").AfterPackContext} context */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • xattr -cr ${appPath}`);
  execFileSync("xattr", ["-cr", appPath], { stdio: "inherit" });
};
