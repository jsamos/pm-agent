/**
 * List all available tools on an MCP server.
 * Shows tool names, descriptions, and parameter schemas.
 *
 * Usage: npx tsx src/scripts/list-tools.ts <service>
 *        npx tsx src/scripts/list-tools.ts <service> --verbose
 */

import "dotenv/config";
import { connect, disconnect, listServices, getServiceConfig } from "../lib/connection.js";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const service = args[0];
  const verbose = process.argv.includes("--verbose");

  if (!service) {
    const available = listServices();
    console.log("Usage: npm run tools -- <service>");
    console.log(`\nAvailable services: ${available.join(", ")}`);
    process.exit(1);
  }

  const config = getServiceConfig(service);

  console.log(`Connecting to ${config.name} MCP server...\n`);

  try {
    const client = await connect(service);
    const { tools } = await client.listTools();

    console.log(`Found ${tools.length} tools:\n`);

    for (const tool of tools) {
      console.log(`  ${tool.name}`);
      if (tool.description) {
        console.log(`    ${tool.description.slice(0, 100)}${tool.description.length > 100 ? "..." : ""}`);
      }

      if (verbose && tool.inputSchema) {
        const props = (tool.inputSchema as Record<string, unknown>).properties as
          | Record<string, { type?: string; description?: string }>
          | undefined;

        if (props) {
          const required = ((tool.inputSchema as Record<string, unknown>).required as string[]) || [];
          for (const [name, schema] of Object.entries(props)) {
            const req = required.includes(name) ? " (required)" : "";
            console.log(`      • ${name}: ${schema.type || "unknown"}${req}`);
          }
        }
      }
      console.log();
    }

    await disconnect(client);
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed: ${message}`);
    console.error(`  → Run 'npm run check -- ${service}' to diagnose the connection.`);
    process.exit(1);
  }
}

main();
