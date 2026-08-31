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
// Hierarchical lookup stays on. It was disabled here once, to guarantee a
// single copy of React: an app that resolves a different React than the
// one react-native bound to crashes on the first hook. But that flag stops
// Metro looking inside a package's own node_modules, and npm legitimately
// nests one there when it cannot hoist it, which is where `expo` keeps
// `expo-modules-core`. The bundle then fails to resolve a dependency that
// is installed and correct.
//
// The singleton is a property of the install, not of the resolver: with
// one React in the tree there is nothing else to resolve to, and
// scripts/check-consistency.mjs fails the build if a second one appears.

module.exports = config;
