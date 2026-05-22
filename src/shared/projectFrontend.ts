import type {
  BackendServiceName,
  BackendType,
  ProjectFrontendConfig,
  ProjectSettingsRecord,
  ServiceConfig,
  ServiceName,
} from "./dashboardTypes";

type UnknownRecord = Record<string, unknown>;

const EMPTY_FRONTEND: ProjectFrontendConfig = {
  enabled: false,
  path: "",
  installCommand: "",
  devCommand: "",
  buildCommand: "",
};

export function isProjectFrontendEnabled(
  settings: ProjectSettingsRecord,
): boolean {
  return settings.frontend.enabled === true;
}

export function getProjectServiceNames(
  settings: ProjectSettingsRecord,
): ServiceName[] {
  const backendService = getProjectBackendServiceName(settings);
  return isProjectFrontendEnabled(settings)
    ? ["frontend", backendService]
    : [backendService];
}

export function getProjectBackendServiceName(
  settings: ProjectSettingsRecord,
): BackendServiceName {
  return normalizeBackendType(settings.backendType);
}

export function getProjectBackendLabel(
  backendTypeOrSettings: BackendType | ProjectSettingsRecord,
): string {
  const backendType =
    typeof backendTypeOrSettings === "string"
      ? backendTypeOrSettings
      : getProjectBackendServiceName(backendTypeOrSettings);
  return backendType === "python" ? "Python" : "WildFly";
}

export function getProjectBackendUrl(settings: ProjectSettingsRecord): string {
  const backend = settings.services[getProjectBackendServiceName(settings)];
  return backend.appUrl || backend.healthUrl || "";
}

export function getProjectBackendManagementUrl(
  settings: ProjectSettingsRecord,
): string {
  const backend = settings.services[getProjectBackendServiceName(settings)];
  return backend.managementUrl || "";
}

export function normalizeBackendType(value: unknown): BackendType {
  return value === "python" ? "python" : "wildfly";
}

export function getProjectFrontendUrl(settings: ProjectSettingsRecord): string {
  if (!isProjectFrontendEnabled(settings)) {
    return "";
  }

  const frontend = settings.services.frontend;
  return frontend.appUrl || frontend.healthUrl || "";
}

export function normalizeProjectSettings(
  settings: ProjectSettingsRecord | unknown,
  defaults: ProjectSettingsRecord,
): ProjectSettingsRecord {
  const raw = isRecord(settings) ? settings : {};
  const rawServices = isRecord(raw.services) ? raw.services : {};
  const rawFrontendService = isRecord(rawServices.frontend)
    ? rawServices.frontend
    : {};
  const rawWildflyService = isRecord(rawServices.wildfly)
    ? rawServices.wildfly
    : {};
  const rawPythonService = isRecord(rawServices.python)
    ? rawServices.python
    : {};
  const rawFrontendConfig = isRecord(raw.frontend) ? raw.frontend : {};
  const rawMaven = isRecord(raw.maven) ? raw.maven : {};
  const backendType = normalizeBackendType(defaults.backendType);

  const frontendEnabled = resolveFrontendEnabled(
    rawFrontendConfig,
    rawFrontendService,
  );
  const frontendPath = stringValue(
    rawFrontendConfig.path,
    stringValue(rawFrontendService.workingDirectory, defaults.frontend.path),
  );
  const frontendDevCommand = stringValue(
    rawFrontendConfig.devCommand,
    stringValue(rawFrontendService.command, defaults.frontend.devCommand),
  );
  const frontend: ProjectFrontendConfig = {
    enabled: frontendEnabled,
    path: frontendPath,
    installCommand: stringValue(
      rawFrontendConfig.installCommand,
      defaults.frontend.installCommand,
    ),
    devCommand: frontendDevCommand,
    buildCommand: stringValue(
      rawFrontendConfig.buildCommand,
      defaults.frontend.buildCommand,
    ),
  };

  const frontendService = normalizeServiceConfig(
    rawFrontendService,
    defaults.services.frontend,
    {
      enabled: frontend.enabled,
      workingDirectory: frontend.path ?? "",
      command: frontend.devCommand ?? "",
      autoStart: frontend.enabled
        ? booleanValue(rawFrontendService.autoStart, false)
        : false,
    },
  );
  const wildflyService = normalizeServiceConfig(
    rawWildflyService,
    defaults.services.wildfly,
    { enabled: true },
  );
  const pythonService = normalizeServiceConfig(
    rawPythonService,
    defaults.services.python,
    { enabled: true },
  );

  return {
    ...defaults,
    backendType,
    appLogFile: stringValue(raw.appLogFile, defaults.appLogFile),
    gitProjectDirectory: stringValue(
      raw.gitProjectDirectory,
      defaults.gitProjectDirectory,
    ),
    defaultBranch: stringValue(raw.defaultBranch, defaults.defaultBranch),
    remote: stringValue(raw.remote, defaults.remote),
    frontend,
    services: {
      frontend: frontendService,
      wildfly: wildflyService,
      python: pythonService,
    },
    maven: {
      executable: stringValue(rawMaven.executable, defaults.maven.executable),
      settingsXml: stringValue(
        rawMaven.settingsXml,
        defaults.maven.settingsXml,
      ),
      pomXml: stringValue(rawMaven.pomXml, defaults.maven.pomXml),
      skipTests: booleanValue(rawMaven.skipTests, defaults.maven.skipTests),
    },
    buildProfiles: Array.isArray(raw.buildProfiles)
      ? raw.buildProfiles
      : defaults.buildProfiles,
  };
}

function normalizeServiceConfig(
  raw: UnknownRecord,
  defaults: ServiceConfig,
  overrides: Partial<ServiceConfig>,
): ServiceConfig {
  return {
    ...defaults,
    enabled: booleanValue(raw.enabled, defaults.enabled ?? true),
    workingDirectory: stringValue(
      raw.workingDirectory,
      defaults.workingDirectory,
    ),
    command: stringValue(raw.command, defaults.command),
    healthUrl: stringValue(raw.healthUrl, defaults.healthUrl),
    appUrl: stringValue(raw.appUrl, defaults.appUrl),
    managementUrl: stringValue(raw.managementUrl, defaults.managementUrl),
    autoStart: booleanValue(raw.autoStart, defaults.autoStart ?? false),
    ...overrides,
  };
}

function resolveFrontendEnabled(
  frontendConfig: UnknownRecord,
  frontendService: UnknownRecord,
): boolean {
  if (typeof frontendConfig.enabled === "boolean") {
    return frontendConfig.enabled;
  }
  if (typeof frontendService.enabled === "boolean") {
    return frontendService.enabled;
  }

  return hasMeaningfulFrontendConfig(frontendConfig, frontendService);
}

function hasMeaningfulFrontendConfig(
  frontendConfig: UnknownRecord,
  frontendService: UnknownRecord,
): boolean {
  return [
    frontendConfig.path,
    frontendConfig.installCommand,
    frontendConfig.devCommand,
    frontendConfig.buildCommand,
    frontendService.workingDirectory,
    frontendService.command,
    frontendService.healthUrl,
    frontendService.appUrl,
  ].some((value) => typeof value === "string" && value.trim().length > 0);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
