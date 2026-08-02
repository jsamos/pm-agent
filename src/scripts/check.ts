/**
 * Check if the Atlassian MCP connection is healthy.
 * Attempts to connect and list tools — if it succeeds, the token is valid.
 * If it fails, reports the error clearly.
 *
 * Usage: npx tsx src/scripts/check.ts
 */

import { connect, disconnect } from "../lib/connection.js";

async function main() {
  console.log("Checking Atlassian MCP connection...\n");

  const start = Date.now();

  try {
    const client = await connect();
    const elapsed = Date.now() - start;

    const { tools } = await client.listTools();

    console.log(`✓ Connected in ${elapsed}ms`);
    console.log(`✓ Token is valid`);
    console.log(`✓ ${tools.length} tools available\n`);

    await disconnect(client);
    process.exit(0);
  } catch (err: unknown) {
    const elapsed = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    console.error(`✗ Connection failed after ${elapsed}ms`);
    console.error(`  Error: ${message}\n`);

    if (message.includes("auth") || message.includes("401") || message.includes("403")) {
      console.error("  → Token may be expired. Run: npm run auth");
    } else if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED")) {
      console.error("  → Network issue. Check your internet connection.");
    } else {
      console.error("  → Run with DEBUG=* for more details.");
    }

    process.exit(1);
  }
}

main();
