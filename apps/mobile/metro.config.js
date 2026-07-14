const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

/**
 * Metro must be told about the monorepo explicitly: @synitheia/shared is consumed as
 * TypeScript source, not a built package, so it has to be watched and resolvable from
 * the workspace root rather than only from apps/mobile/node_modules.
 *
 * Hierarchical lookup stays ON, deliberately. The repo installs with
 * `node-linker=hoisted` (see .npmrc) because React Native's toolchain resolves a long
 * tail of peers implicitly — @babel/runtime, @expo/metro-runtime, and more — and expects
 * to walk up an npm-style node_modules to find them. Disabling that walk breaks
 * resolution one package at a time, which is exactly how this first failed.
 */
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * Resolve TypeScript-ESM `.js` specifiers to the `.ts` sources they actually name.
 *
 * Under `moduleResolution: bundler`/`nodenext`, a TS file that imports `./tokens.js`
 * is referring to `./tokens.ts` — the extension describes the *emitted* file, not the
 * one on disk. `tsc` understands this and so does Node's ESM loader; Metro does not,
 * and reports "Unable to resolve ../../src/theme/tokens.js".
 *
 * Stripping the extensions instead is not an option: @synitheia/shared is consumed as
 * source by this app AND compiled to real Node ESM for the API, where the `.js`
 * specifiers are mandatory. So the two consumers disagree, and this is where that
 * disagreement gets reconciled — once, rather than in every import statement.
 */
const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = originalResolveRequest ?? context.resolveRequest;

  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const withoutExt = moduleName.slice(0, -3);
    try {
      return resolve(context, withoutExt, platform);
    } catch {
      // Fall through — it really was a .js file on disk.
    }
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
