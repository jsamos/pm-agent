import modelsConfig from "../config/models.json" with { type: "json" };

export interface ModelRoute {
  provider: string;
  modelId: string;
}

export interface ToolLlmOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export type ToolEntry = string | ToolLlmOptions;

export interface ToolLlmConfig {
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface ModelsConfig {
  default: string;
  agents: Record<string, string>;
  tools?: Record<string, ToolEntry>;
  routes: Record<string, ModelRoute>;
}

export interface ResolvedModel {
  logicalName: string;
  provider: string;
  modelId: string;
}

const config = modelsConfig as ModelsConfig;

const DEFAULT_TOOL_MAX_TOKENS = 4096;
const DEFAULT_TOOL_TEMPERATURE = 0.3;

function toolModelName(entry: ToolEntry): string {
  return typeof entry === "string" ? entry : entry.model;
}

function resolveToolEntry(entry: ToolEntry, fallbackModel: string): ToolLlmConfig {
  if (typeof entry === "string") {
    return {
      model: entry,
      maxTokens: DEFAULT_TOOL_MAX_TOKENS,
      temperature: DEFAULT_TOOL_TEMPERATURE,
    };
  }
  return {
    model: entry.model,
    maxTokens: entry.maxTokens ?? DEFAULT_TOOL_MAX_TOKENS,
    temperature: entry.temperature ?? DEFAULT_TOOL_TEMPERATURE,
  };
}

export function loadModelsConfig(): ModelsConfig {
  return config;
}

export function validateModelConfig(cfg: ModelsConfig = config): void {
  const assigned = new Set<string>([cfg.default]);
  for (const name of Object.values(cfg.agents)) assigned.add(name);
  if (cfg.tools) {
    for (const entry of Object.values(cfg.tools)) assigned.add(toolModelName(entry));
  }

  const missing: string[] = [];
  for (const name of assigned) {
    if (!cfg.routes[name]) missing.push(name);
  }

  if (missing.length > 0) {
    throw new Error(
      `models.json: missing routes for logical model(s): ${missing.sort().join(", ")}`,
    );
  }
}

export function resolveModel(logicalName: string, cfg: ModelsConfig = config): ResolvedModel {
  const key = logicalName.trim();
  if (!key) {
    throw new Error("No logical model name provided.");
  }

  const route = cfg.routes[key];
  if (!route) {
    const available = Object.keys(cfg.routes).sort().join(", ");
    throw new Error(`Unknown logical model "${key}". Available: ${available}`);
  }

  return {
    logicalName: key,
    provider: route.provider,
    modelId: route.modelId,
  };
}

export function getDefaultLogicalModel(cfg: ModelsConfig = config): string {
  return cfg.default;
}

export function getModel(agentName?: string, cfg: ModelsConfig = config): string {
  if (agentName && cfg.agents[agentName]) {
    return cfg.agents[agentName];
  }
  return cfg.default;
}

export function getToolModel(toolName: string, cfg: ModelsConfig = config): string {
  const entry = cfg.tools?.[toolName];
  if (entry) return toolModelName(entry);
  return cfg.default;
}

export function getToolLlmConfig(toolName: string, cfg: ModelsConfig = config): ToolLlmConfig {
  const entry = cfg.tools?.[toolName];
  if (entry) return resolveToolEntry(entry, cfg.default);
  return resolveToolEntry(cfg.default, cfg.default);
}

let validated = false;

export function ensureModelConfigValid(): void {
  if (!validated) {
    validateModelConfig();
    validated = true;
  }
}
