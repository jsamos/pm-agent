/**
 * Check if an MCP service connection is healthy.
 * Attempts to connect and list tools — if it succeeds, the token is valid.
 *
 * Usage: npx tsx src/scripts/check.ts <service>
 */

import "dotenv/config";
import { connect, disconnect, listServices, getServiceConfig } from "../lib/connection.js";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const service = args[0];

  if (!service) {
    const available = listServices();
    console.log("Usage: npm run check -- <service>");
    console.log(`\nAvailable services: ${available.join(", ")}`);
    process.exit(1);
  }

  const config = getServiceConfig(service);

  console.log(`Checking ${config.name} MCP connection...\n`);

  const start = Date.now();

  try {
    const client = await connect(service);
    const elapsed = Date.now() - start;

    const { tools } = await client.listTools();

    console.log(`✓ Connected to ${config.name} in ${elapsed}ms`);
    console.log(`✓ Token is valid`);
    console.log(`✓ ${tools.length} tools available\n`);

    await disconnect(client);
    process.exit(0);
  } catch (err: unknown) {
    const elapsed = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    console.error(`✗ Connection to ${config.name} failed after ${elapsed}ms`);
    console.error(`  Error: ${message}\n`);

    if (message.includes("auth") || message.includes("401") || message.includes("403")) {
      console.error(`  → Token may be expired. Run: npm run auth -- ${service}`);
    } else if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED")) {
      console.error("  → Network issue. Check your internet connection.");
    } else {
      console.error("  → Run with DEBUG=* for more details.");
    }

    process.exit(1);
  }
}

main();
