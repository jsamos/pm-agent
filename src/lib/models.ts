/**
 * Resolves which LLM model to use for a given agent or tool.
 * Falls back to the default if no specific override exists.
 */

import modelsConfig from "../config/models.json" with { type: "json" };

const config = modelsConfig as {
  default: string;
  agents: Record<string, string>;
  tools?: Record<string, string>;
};

export function getModel(agentName?: string): string {
  if (agentName && config.agents[agentName]) {
    return config.agents[agentName];
  }
  return config.default;
}

export function getToolModel(toolName: string): string {
  if (config.tools?.[toolName]) {
    return config.tools[toolName];
  }
  return config.default;
}
