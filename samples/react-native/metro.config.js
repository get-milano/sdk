// The sample consumes the engine through the npm workspace: the packages
// are symlinked, and their `exports` point at `dist/`, so run
// `npm run build` at the workspace root after editing engine sources.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..", "..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enablePackageExports = true;
// One copy of React, always: without this Metro walks up from a nested
// node_modules and an app that resolves a different React than the one
// react-native bound to crashes on the first hook.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
