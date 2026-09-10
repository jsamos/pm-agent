/**
 * Tool: generate_meeting_ppoa
 * Produces a PPOA breakdown from a meeting transcript using a dedicated LLM call.
 * Reads the transcript from the prior fetch_notion_transcript result in toolCallLog,
 * or accepts it directly via the `transcript` parameter.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { getToolLlmConfig } from "../../lib/models.js";
import { trace } from "../../lib/agent-loop.js";
import { loadRosterFile } from "../roster/read.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, "../../prompts/meeting-ppoa.md"), "utf-8").trim();

function buildRosterContext(): string {
  const roster = loadRosterFile();
  if (!roster.resolved.length) return "";
  const names = roster.resolved.map((r) => r.displayName);
  return `\nTeam roster (use these exact names in the output):\n${names.join(", ")}\n`;
}

function resolveTranscript(context: ExecutionContext, args: Record<string, unknown>): { transcript: string; title: string } {
  if (typeof args.transcript === "string" && args.transcript.trim()) {
    return { transcript: args.transcript.trim(), title: (args.title as string) || "Meeting" };
  }

  const log = context.toolCallLog;
  if (log) {
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].tool !== "fetch_notion_transcript") continue;
      const result = log[i].result as Record<string, unknown> | null;
      if (result && typeof result.transcript === "string") {
        return {
          transcript: result.transcript as string,
          title: (result.title as string) || "Meeting",
        };
      }
    }
  }

  throw new Error(
    "No transcript available. Either pass a transcript parameter or call fetch_notion_transcript first.",
  );
}

export const generateMeetingPpoaTool: Tool = {
  name: "generate_meeting_ppoa",
  description:
    "Generate a PPOA breakdown (Product Requirements, Project Management, Open Questions, Action Items) " +
    "from a meeting transcript. Reads the transcript from the prior fetch_notion_transcript result, " +
    "or accepts it directly via the transcript parameter. Uses a dedicated LLM call with focused PPOA instructions.",
  parameters: {
    type: "object",
    properties: {
      transcript: {
        type: "string",
        description: "Raw transcript text. Optional if fetch_notion_transcript was called earlier in this session.",
      },
      title: {
        type: "string",
        description: "Meeting title for the output header. Optional — inferred from fetch_notion_transcript if available.",
      },
    },
  },

  async execute(args, context: ExecutionContext) {
    const { transcript, title } = resolveTranscript(context, args);
    const toolLlm = getToolLlmConfig("generate_meeting_ppoa");

    trace("inner_llm_request", {
      tool: "generate_meeting_ppoa",
      groupKey: title,
      transcriptChars: transcript.length,
    });

    const rosterContext = buildRosterContext();
    const systemPrompt = rosterContext
      ? SYSTEM_PROMPT + "\n" + rosterContext
      : SYSTEM_PROMPT;

    const llmStart = Date.now();
    const response = await context.llm.generate(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcript },
      ],
      {
        model: toolLlm.model,
        temperature: toolLlm.temperature,
        maxTokens: toolLlm.maxTokens,
      },
    );
    const llmMs = Date.now() - llmStart;
    const markdown = (response.content || "").trim();

    process.stderr.write(`  [ppoa] ${title} — ${llmMs}ms\n`);

    trace("inner_llm_call", {
      tool: "generate_meeting_ppoa",
      groupKey: title,
      ms: llmMs,
      responseChars: markdown.length,
    });

    if (!markdown) {
      return { ppoa: "", summary: "PPOA generation failed — no output from LLM." };
    }

    const ppoa = `# ${title}\n\n${markdown}`;

    return {
      ppoa,
      title,
      charCount: markdown.length,
      summary: `PPOA generated for "${title}" (${markdown.length} chars).`,
      finalOutput: true,
    };
  },
};
