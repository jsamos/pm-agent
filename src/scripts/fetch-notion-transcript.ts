/**
 * Fetch a meeting transcript from Notion and print it to stdout.
 *
 * Usage: npm run fetch-transcript -- <notion-page-url>
 */

import "dotenv/config";
import { fetchNotionTranscriptTool } from "../tools/notion/fetch-transcript.js";

async function main() {
  const pageUrl = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

  if (!pageUrl) {
    console.error("Usage: npm run fetch-transcript -- <notion-page-url>");
    process.exit(1);
  }

  try {
    const result = (await fetchNotionTranscriptTool.execute!(
      { pageUrl },
      { toolCallLog: [], config: {} },
    )) as {
      title: string;
      transcript: string;
      charCount: number;
      url: string;
    };

    process.stderr.write(`Fetched "${result.title}" (${result.charCount} chars)\n`);
    if (result.url) process.stderr.write(`Source: ${result.url}\n`);
    process.stderr.write("\n");
    process.stdout.write(result.transcript);
    if (!result.transcript.endsWith("\n")) process.stdout.write("\n");
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to fetch transcript: ${message}`);
    if (message.includes("auth") || message.includes("401") || message.includes("403")) {
      console.error("→ Run: npm run auth -- notion");
    }
    process.exit(1);
  }
}

main();
