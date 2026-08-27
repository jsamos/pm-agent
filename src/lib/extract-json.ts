/**
 * Extract a JSON object string from LLM output that may include fences or preamble.
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  // Opening fence without a reliable closing match (common when output is truncated)
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  }

  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}
