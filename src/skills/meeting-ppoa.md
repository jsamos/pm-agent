---
name: meeting-ppoa
description: Summarize a meeting transcript into four sections — Product Requirements, Project Management, Open Questions, Action Items. Use whenever the user asks for a "PPOA" summary/breakdown, or asks to summarize a meeting/transcript by product requirements, project management, open questions, and action items. Trigger on phrasings like "summarize this meeting", "break this transcript down into requirements/open questions/action items", or "give me the PPOA for this". If the user also asks to save it to Notion, write it as a child page under the location they specify, naming the page similarly to the source meeting page/transcript.
---

# Meeting PPOA Summary

Workflow (follow this order):
  1. If the user provided a Notion page URL, call fetch_notion_transcript to get the raw transcript
  2. If the user pasted or uploaded a transcript, use it directly — no fetch needed
  3. Produce the four-section PPOA breakdown below using the transcript text

## Output format

Respond in chat by default — no file, no preamble beyond a brief lead-in. Only write to Notion (or another destination) if the user explicitly asks.

Use exactly these four headers, in this order. Omit a section only if it is genuinely empty — don't force content into a section it doesn't belong in.

```
## Product Requirements
- ...

## Project Management
- ...

## Open Questions
- ...

## Action Items
- ...
```

## What goes where

**Product Requirements** — concrete facts about what the product/system must do, support, or constrain: data formats, fields, limits, capabilities confirmed by either side, technical constraints that shape what can be built. If a constraint (e.g. a character limit) shapes what the product can output, it's a requirement, not a process note — don't file it under Project Management just because it sounds procedural.

**Project Management** — coordination, staffing, sprint/timeline status, cadence, meeting logistics, who's doing what kind of work in what timeframe. Do not include the mechanics of the meeting itself (e.g. "there were duplicate invites," "the meeting was recorded") — that's noise, not project status.

**Open Questions** — anything raised but not resolved: a decision still pending, a convention not yet agreed, a fact neither side confirmed. If two open questions are really the same underlying unresolved issue viewed from two angles, merge them into one bullet rather than listing both.

**Action Items** — concrete next steps, each with an owner if the transcript makes the owner clear ("Zach → send sample Swagger schema"). Skip vague intentions with no clear next step; keep each item to one line.

**Avoid duplicating Project Management and Action Items.** These two sections often describe the same fact from two angles (status vs. task) — don't let the same information appear as a full sentence in both. Project Management carries the context: status, timeline, rationale, dependencies. Action Items is a terse checklist: owner → verb phrase, no restated justification or timeline unless it's not already covered in Project Management. If a bullet would be near-identical across both sections, keep the fuller version in Project Management and reduce the Action Items version to the shortest actionable phrase (owner + verb + object only).

## Guidelines

- **Be concise.** One line per bullet wherever possible. Don't editorialize or add analysis beyond what was said.
- **Don't merge across sections.** A requirement is a fact about the product; a project-management item is a fact about process/timeline; don't blend them into one bullet.
- **Coverage.** Go through the whole transcript — don't stop after the first few points per section.
- **Attribution matters.** When the transcript specifies which side/person owns a capability or a constraint (e.g. "rotation metadata is feasible on HS1's side," not "on Pearl's side"), preserve that attribution exactly — getting this backwards is a common and costly mistake.
- **No filler bullets.** Skip housekeeping like "meeting was recorded," "invite was duplicated," introductions, or small talk — none of that belongs in any of the four sections.
- **If asked to write to Notion**, name the new page similarly to the source meeting page (e.g. same meeting name + date), and create it as a child of the location the user specifies. After creating the page, add an `## Transcript` heading at the end of its content, then move the source meeting page to be a child page of the newly created page (nested under that Transcript heading). Confirm the page link back to the user without extra commentary.

## Enrich PPOA

Trigger this when, after generating a PPOA, the user provides an additional source and asks to "enrich," "add context," "add links," or similar.

1. **Fetch the additional context.** Read the full source before touching the PPOA.
2. **Cross-reference, don't rewrite.** Go bullet by bullet through the existing PPOA. For each one, check whether the new context adds a concrete match — a tracked item, a name, a status, a missing detail.
3. **Link inline, not appended.** When a bullet clearly maps to something identifiable in the new context, turn the relevant phrase itself into the link — not a link tacked onto the end of the bullet.
4. **Expand only with confirmed detail.** If the context gives a fuller description of something the original source only gestured at, you may extend the bullet with that description — but only using facts actually present in the new context, never inferred or invented.
5. **Correct misattributions.** If the new context reveals a name, category, or ownership error from the original source (a misheard name, an item filed under the wrong section, a person's role), fix it in place rather than leaving it as a caveat.
6. **Confidence bar.** Only add a link or expand a bullet when the match is clear. If a bullet could plausibly map to more than one item in the new context, leave it unlinked rather than guessing.
7. **No unrelated additions.** Don't pull unrelated facts from the new context into the PPOA just because they're present — only enrich existing bullets, don't introduce new ones from the secondary source.
