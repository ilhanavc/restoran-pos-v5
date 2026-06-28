// Metro config for pnpm monorepo (ADR-025 K7).
//
// Root .npmrc stays `isolated` (symlinked) — `apps/mobile/.npmrc`
// `node-linker=hoisted` is a NO-OP because pnpm reads node-linker ONLY from
// the workspace-root .npmrc. We therefore solve dependency resolution on the
// Metro side instead of switching the whole repo to a hoisted layout:
//   - watchFolders: watch the workspace root so symlinked workspace packages
//     (shared-types, shared-domain) trigger HMR.
//   - resolver.nodeModulesPaths: look in the app's own node_modules first,
//     then the workspace root's (two levels).
//   - unstable_enableSymlinks: follow pnpm symlinks.
//   - unstable_enablePackageExports: honor "exports" maps in package.json.
// We do NOT enable disableHierarchicalLookup: under the isolated linker the
// hierarchical lookup is what lets nested .pnpm dependencies resolve.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Append the workspace root to Expo's default watchFolders (do not replace —
// the defaults already include the project root, which expo-doctor verifies).
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
