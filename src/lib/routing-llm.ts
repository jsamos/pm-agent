import type { LLM, LLMOptions, LLMResponse, Message, ToolDefinition } from "./llm.js";
import type { ResolvedModel } from "./resolve-model.js";

export interface RoutingLLMOptions {
  backends: Record<string, () => LLM>;
  defaultLogicalModel: string;
  resolve: (logicalName: string) => ResolvedModel;
}

export function createRoutingLLM(options: RoutingLLMOptions): LLM {
  const cache: Record<string, LLM> = {};

  function backendFor(provider: string): LLM {
    if (cache[provider]) return cache[provider];
    const factory = options.backends[provider];
    if (!factory) {
      throw new Error(
        `Model route uses unknown provider "${provider}". Registered: ${Object.keys(options.backends).sort().join(", ")}`,
      );
    }
    cache[provider] = factory();
    return cache[provider];
  }

  const resolve = options.resolve;
  const defaultLogicalModel = options.defaultLogicalModel;

  return {
    async generate(messages: Message[], callOptions?: LLMOptions): Promise<LLMResponse> {
      const logical = callOptions?.model?.trim() || defaultLogicalModel;
      const resolved = resolve(logical);
      const backend = backendFor(resolved.provider);
      return backend.generate(messages, { ...callOptions, model: resolved.modelId });
    },

    async generateWithTools(
      messages: Message[],
      tools: ToolDefinition[],
      callOptions?: LLMOptions,
    ): Promise<LLMResponse> {
      const logical = callOptions?.model?.trim() || defaultLogicalModel;
      const resolved = resolve(logical);
      const backend = backendFor(resolved.provider);
      return backend.generateWithTools(messages, tools, {
        ...callOptions,
        model: resolved.modelId,
      });
    },
  };
}
