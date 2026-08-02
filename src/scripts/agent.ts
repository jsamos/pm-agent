/**
 * PM Agent CLI — unified natural language interface.
 *
 * Usage: npx tsx src/scripts/agent.ts "what's in the sprint"
 *        npx tsx src/scripts/agent.ts "add Cristian to the roster"
 */

import "dotenv/config";
import { openaiProvider } from "../lib/providers/openai.js";
import { createContext } from "../lib/context.js";
import { getModel } from "../lib/models.js";
import { runAgent } from "../agent/agent.js";
import config from "../config/jira.json" with { type: "json" };

const task = process.argv.slice(2).join(" ");

if (!task) {
  process.stderr.write("Usage: npx tsx src/scripts/agent.ts <task>\n");
  process.exit(1);
}

async function main() {
  const llm = openaiProvider.create({ model: getModel("agent") });
  const context = createContext({
    llm,
    config: config as unknown as Record<string, unknown>,
    workflowName: "agent",
    stepName: "run",
  });

  process.stderr.write(`Task: ${task}\n\n`);

  const result = await runAgent(task, context);

  // Log diff result to stderr if present
  const diffCall = result.toolCalls.find((tc) => tc.tool === "jira_search_snapshots" && (tc.args as Record<string, unknown>).action === "diff");
  if (diffCall) {
    const diffResult = diffCall.result as { summary?: string; changed?: boolean } | null;
    if (diffResult?.summary) {
      process.stderr.write(`  [diff] ${diffResult.summary}\n`);
    }
  }

  // Check toolCalls for a narrative (bypasses LLM rewriting)
  const narrativeCall = result.toolCalls.find(
    (tc) => tc.tool === "generate_epic_narrative" || tc.tool === "generate_sprint_narrative"
  );
  if (narrativeCall) {
    const res = narrativeCall.result as { narrative?: string };
    console.log(res.narrative || result.response);
  } else {
    console.log(result.response);
  }
  process.stderr.write(`\n(${result.turns} turns, ${result.toolCalls.length} tool calls)\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
