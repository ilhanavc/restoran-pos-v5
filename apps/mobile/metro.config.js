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

// pnpm hoists a SECOND React (18.3.1, pulled by apps/web) to the workspace-root
// node_modules. Because nodeModulesPaths includes that root, Metro can resolve
// some `react` imports to 18.3.1 while react-native's renderer runs on 19.1.0 —
// "Invalid hook call / more than one copy of React" plus a null hook dispatcher
// ("Cannot read property 'useContext' of null"). Force every react /
// react-native request to resolve from the app root so the bundle holds exactly
// one copy (ADR-025 K7: solve on the Metro side, do not switch the linker).
const singletonRoots = ['react', 'react-native'];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned = singletonRoots.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  return context.resolveRequest(
    pinned
      ? { ...context, originModulePath: path.join(projectRoot, 'index.js') }
      : context,
    moduleName,
    platform,
  );
};

module.exports = config;
