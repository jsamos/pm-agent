/**
 * Parse meeting transcript from Notion MCP enhanced-markdown response.
 *
 * Notion meeting-note pages wrap the raw transcript in <transcript> tags.
 * The transcript is only present when `include_transcript: true` is passed
 * to the notion-fetch MCP tool.
 */

const TRANSCRIPT_RE = /<transcript>([\s\S]*?)<\/transcript>/;
const OMITTED_RE = /Transcript omitted/i;
const PAGE_URL_RE = /<page\s+url="([^"]+)">/;
const MEETING_TITLE_RE = /<meeting-notes[^>]*>\n?\t?([^\n<]+)/;

/** Extract raw transcript text from a Notion MCP fetch response. */
export function extractTranscriptText(raw: string): string | null {
  const match = raw.match(TRANSCRIPT_RE);
  if (!match) return null;

  const body = match[1];
  if (OMITTED_RE.test(body)) return null;

  const cleaned = body
    .split("\n")
    .map((line) => line.replace(/^\t+/, ""))
    .join("\n")
    .trim();

  return cleaned || null;
}

/** Extract the meeting title from inside the <meeting-notes> tag. */
export function extractMeetingTitle(raw: string): string | null {
  const match = raw.match(MEETING_TITLE_RE);
  if (!match) return null;
  return match[1].trim() || null;
}

/** Extract the page URL from the <page url="…"> wrapper. */
export function extractPageUrl(raw: string): string | null {
  const match = raw.match(PAGE_URL_RE);
  return match?.[1] ?? null;
}
