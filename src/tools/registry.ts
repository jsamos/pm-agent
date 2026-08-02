/**
 * Local tool registry.
 * Tools have the same shape as OpenAI function-calling tools so they can be
 * presented to the LLM alongside MCP tools.
 */

import type { ExecutionContext } from "../lib/context.js";

export interface ToolParameter {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter;
  execute(args: Record<string, unknown>, context: ExecutionContext): Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** Human-readable tool catalog for inclusion in system prompts */
  toCatalog(): string {
    return this.list()
      .map((t) => `- ${t.name} — ${t.description}`)
      .join("\n");
  }

  /** Format for OpenAI function-calling tool list */
  toOpenAITools(): Array<{ type: "function"; function: { name: string; description: string; parameters: ToolParameter } }> {
    return this.list().map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async call(name: string, args: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(args, context);
  }
}

