import { ToolRegistry } from "../tools/registry.js";
import {
  resolveAssigneesTool,
  buildSprintJqlTool,
  buildEpicJqlTool,
  searchIssuesTool,
  searchUsersTool,
  jiraSearchSnapshotsTool,
  groupIssuesTool,
  generateEpicNarrativeTool,
  generateSprintNarrativeTool,
} from "../tools/jira/index.js";
import { readRosterTool, writeRosterTool } from "../tools/roster/index.js";
import { searchSlackUsersTool, sendSlackMessageTool } from "../tools/slack/index.js";
import { loadSkillTool } from "../tools/skills/index.js";

export function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Jira tools
  registry.register(resolveAssigneesTool);
  registry.register(buildSprintJqlTool);
  registry.register(buildEpicJqlTool);
  registry.register(searchIssuesTool);
  registry.register(jiraSearchSnapshotsTool);
  registry.register(groupIssuesTool);
  registry.register(generateEpicNarrativeTool);
  registry.register(generateSprintNarrativeTool);

  // User lookup
  registry.register(searchUsersTool);

  // Roster management
  registry.register(readRosterTool);
  registry.register(writeRosterTool);

  // Slack tools
  registry.register(searchSlackUsersTool);
  registry.register(sendSlackMessageTool);

  // Skill loader
  registry.register(loadSkillTool);

  return registry;
}
