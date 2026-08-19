/**
 * Authenticate with an MCP service.
 * Clears cached tokens (with --force) and triggers the OAuth browser flow.
 *
 * Usage: npx tsx src/scripts/auth.ts <service>
 *        npx tsx src/scripts/auth.ts <service> --force
 */

import "dotenv/config";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { connect, disconnect, listServices, getServiceConfig } from "../lib/connection.js";

const MCP_AUTH_DIR = join(homedir(), ".mcp-auth");

function clearCachedTokens() {
  if (!existsSync(MCP_AUTH_DIR)) {
    console.log("No cached tokens found at ~/.mcp-auth/");
    return;
  }

  const files = readdirSync(MCP_AUTH_DIR);
  if (files.length === 0) {
    console.log("Token cache is empty.");
    return;
  }

  console.log(`Clearing ${files.length} cached token file(s) from ~/.mcp-auth/...`);
  rmSync(MCP_AUTH_DIR, { recursive: true, force: true });
  console.log("✓ Token cache cleared.\n");
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const service = args[0];
  const forceRefresh = process.argv.includes("--force");

  if (!service) {
    const available = listServices();
    console.log("Usage: npm run auth -- <service>");
    console.log(`\nAvailable services: ${available.join(", ")}`);
    process.exit(1);
  }

  const config = getServiceConfig(service);

  if (forceRefresh) {
    clearCachedTokens();
  }

  console.log(`Initiating ${config.name} OAuth flow...`);
  console.log("A browser window will open for authentication.\n");

  try {
    const client = await connect(service);
    const { tools } = await client.listTools();

    console.log(`\n✓ Authenticated successfully with ${config.name}`);
    console.log(`✓ ${tools.length} tools available`);
    console.log(`✓ Token cached at ~/.mcp-auth/\n`);

    await disconnect(client);
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Authentication failed: ${message}`);
    process.exit(1);
  }
}

main();
