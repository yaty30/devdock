const fs = require("node:fs");
const path = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

const devOnlyPackages = readDevOnlyPackages();

const packageIgnorePatterns = [
  /^\/(?:src|dummy|installer|tools|scripts|out|dist)(?:\/|$)/,
  /^\/(?:\.git|\.github|\.vscode)(?:\/|$)/,
  /^\/(?:\.gitignore|\.npmignore)$/,
  /^\/node_modules\/\.bin(?:\/|$)/,
  /^\/node_modules\/\.vite(?:\/|$)/,
  /^\/node_modules\/\.package-lock\.json$/,
  /^\/(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  /^\/node_gyp_bins(?:\/|$)/,
  /^\/(?:electron\.vite\.config\.ts|tsconfig(?:\.[^/]*)?\.json|forge\.config\.js)$/,
  /\.o(?:bj)?$/,
  /^\/.*\.tsbuildinfo$/,
  /^\/(?:README(?:\.[^/]*)?|\.env(?:\..*)?)$/,
];

function ignoreDevelopmentFiles(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const scopeName = scopeNameFromNodeModulePath(normalized);
  if (scopeName && devOnlyPackages.scopes.has(scopeName)) {
    return true;
  }

  const moduleName = moduleNameFromNodeModulePath(normalized);
  if (moduleName && devOnlyPackages.modules.has(moduleName)) {
    return true;
  }

  return packageIgnorePatterns.some((pattern) => pattern.test(normalized));
}

function readDevOnlyPackages() {
  const lockPath = path.join(__dirname, "package-lock.json");
  if (!fs.existsSync(lockPath)) {
    return { modules: new Set(), scopes: new Set() };
  }

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const devModules = new Set();
  const prodModules = new Set();
  const devScopes = new Set();
  const prodScopes = new Set();

  for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
    if (!packagePath.startsWith("node_modules/")) {
      continue;
    }

    const moduleName = moduleNameFromLockPackagePath(packagePath);
    if (!moduleName) {
      continue;
    }

    const scopeName = moduleName.startsWith("@")
      ? moduleName.split("/")[0]
      : null;

    if (metadata.dev) {
      devModules.add(moduleName);
      if (scopeName) {
        devScopes.add(scopeName);
      }
    } else {
      prodModules.add(moduleName);
      if (scopeName) {
        prodScopes.add(scopeName);
      }
    }
  }

  return {
    modules: new Set([...devModules].filter((name) => !prodModules.has(name))),
    scopes: new Set([...devScopes].filter((name) => !prodScopes.has(name))),
  };
}

function moduleNameFromLockPackagePath(packagePath) {
  return moduleNameFromParts(packagePath.split("node_modules/").pop().split("/"));
}

function moduleNameFromNodeModulePath(filePath) {
  if (!filePath.startsWith("/node_modules/")) {
    return null;
  }

  return moduleNameFromParts(filePath.slice("/node_modules/".length).split("/"));
}

function scopeNameFromNodeModulePath(filePath) {
  if (!filePath.startsWith("/node_modules/@")) {
    return null;
  }

  const parts = filePath.slice("/node_modules/".length).split("/");
  return parts.length === 1 && parts[0].startsWith("@") ? parts[0] : null;
}

function moduleNameFromParts(parts) {
  if (!parts[0]) {
    return null;
  }

  if (parts[0].startsWith("@")) {
    return parts[1] ? `${parts[0]}/${parts[1]}` : null;
  }

  return parts[0];
}

module.exports = {
  packagerConfig: {
    asar: true,
    prune: true,
    icon: path.join(
      __dirname,
      "src",
      "renderer",
      "src",
      "assets",
      "icon.ico",
    ),
    extraResource: [
      path.join(
        __dirname,
        "src",
        "renderer",
        "src",
        "assets",
        "icon.ico",
      ),
      path.join(__dirname, ".env"),
    ],
    ignore: ignoreDevelopmentFiles,
  },
  rebuildConfig: {
    force: true,
    onlyModules: ['better-sqlite3', 'oracledb', 'node-pty'],
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-deb",
      config: {},
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {},
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "ivs_dashboard",
        authors: "yaty",
        description: "IVS Dashboard",

        setupExe: "IVS-Dashboard-Setup.exe",

        setupIcon: path.join(
          __dirname,
          "src",
          "renderer",
          "src",
          "assets",
          "icon.ico",
        ),

        // Windows shortcuts
        createStartMenuShortcut: true,
        createDesktopShortcut: true,

        // Display name shown in Start Menu / desktop shortcut
        shortcutName: "IVS Dashboard",

        // Optional: Start Menu folder name
        shortcutFolderName: "IVS Dashboard",
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
