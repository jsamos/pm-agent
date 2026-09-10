import { ToolRegistry } from "../tools/registry.js";
import {
  resolveAssigneesTool,
  buildSprintJqlTool,
  buildEpicJqlTool,
  searchIssuesTool,
  searchUsersTool,
  jiraSearchSnapshotsTool,
  jiraNarrativeCacheTool,
  groupIssuesTool,
  generateEpicNarrativeTool,
  generateSprintNarrativeTool,
  cascadeEpicNotionUpdatesTool,
} from "../tools/jira/index.js";
import { readRosterTool, writeRosterTool, resolveEpicWorkPageTool } from "../tools/roster/index.js";
import { searchSlackUsersTool, sendSlackMessageTool } from "../tools/slack/index.js";
import {
  fetchNotionPageTool,
  fetchNotionTranscriptTool,
  createNotionPageTool,
  updateNotionPageTool,
} from "../tools/notion/index.js";
import { generateMeetingPpoaTool } from "../tools/meeting/index.js";
import { loadSkillTool } from "../tools/skills/index.js";

export function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Jira tools
  registry.register(resolveAssigneesTool);
  registry.register(buildSprintJqlTool);
  registry.register(buildEpicJqlTool);
  registry.register(searchIssuesTool);
  registry.register(jiraSearchSnapshotsTool);
  registry.register(jiraNarrativeCacheTool);
  registry.register(groupIssuesTool);
  registry.register(generateEpicNarrativeTool);
  registry.register(generateSprintNarrativeTool);
  registry.register(cascadeEpicNotionUpdatesTool);

  // User lookup
  registry.register(searchUsersTool);

  // Roster management
  registry.register(readRosterTool);
  registry.register(writeRosterTool);
  registry.register(resolveEpicWorkPageTool);

  // Slack tools
  registry.register(searchSlackUsersTool);
  registry.register(sendSlackMessageTool);

  // Notion tools
  registry.register(fetchNotionPageTool);
  registry.register(fetchNotionTranscriptTool);
  registry.register(createNotionPageTool);
  registry.register(updateNotionPageTool);

  // Meeting tools
  registry.register(generateMeetingPpoaTool);

  // Skill loader
  registry.register(loadSkillTool);

  return registry;
}
