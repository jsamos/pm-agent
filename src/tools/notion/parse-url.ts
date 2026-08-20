/**
 * Extract a Notion page ID from a URL or raw UUID.
 *
 * Handles:
 * - https://www.notion.so/workspace/Page-Title-a1b2c3d4e5f67890abcdef1234567890
 * - https://myspace.notion.site/Page-Title-abc123def456
 * - https://www.notion.so/a1b2c3d4e5f67890abcdef1234567890
 * - Raw UUIDs with or without dashes
 */

const UUID_NODASH = /^[0-9a-f]{32}$/i;
const UUID_DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_TAIL = /([0-9a-f]{32})$/i;

export function parseNotionId(input: string): string {
  const trimmed = input.trim();

  if (UUID_NODASH.test(trimmed)) return trimmed;
  if (UUID_DASHED.test(trimmed)) return trimmed.replace(/-/g, "");

  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    const lastSegment = path.split("/").pop() || "";
    const cleaned = lastSegment.split("?")[0].split("#")[0];

    const match = cleaned.match(HEX_TAIL);
    if (match) return match[1];
  } catch {
    // Not a URL — fall through
  }

  throw new Error(
    `Could not extract Notion page ID from "${trimmed.slice(0, 100)}". ` +
    `Provide a Notion URL or a 32-character page ID.`
  );
}
