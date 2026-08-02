/**
 * Tool: search_jira_issues
 * Runs a JQL query against Jira and returns structured issues.
 * Optionally resolves parents up to a target issue type (e.g. "Epic").
 * Generic — any agent that needs to search Jira can use this.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { callJiraTool, extractTextContent } from "./client.js";

export interface SprintInfo {
  id: number;
  name: string;
  state: string;
  boardId: number;
  startDate: string | null;
  endDate: string | null;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  statusCategoryChangedDate: string | null;
  priority: string;
  assignee: string | null;
  parent: { key: string; summary: string; issueType: string } | null;
  issueType: string;
  description: string | null;
  sprint: SprintInfo | null;
}

const BASE_FIELDS = [
  "summary", "status", "priority", "assignee",
  "issuetype", "parent", "description", "statuscategorychangedate",
];

export interface ParseOptions {
  sprintFieldId?: string;
}

export function parseJiraIssues(raw: unknown, options?: ParseOptions): JiraIssue[] {
  const data = raw as { issues?: unknown[] };
  if (!data.issues || !Array.isArray(data.issues)) return [];

  const sprintField = options?.sprintFieldId;

  return data.issues.map((issue: unknown) => {
    const i = issue as Record<string, unknown>;
    const fields = i.fields as Record<string, unknown>;

    const status = fields.status as { name?: string; statusCategory?: { name?: string } } | null;
    const priority = fields.priority as { name?: string } | null;
    const assignee = fields.assignee as { displayName?: string } | null;
    const issueType = fields.issuetype as { name?: string } | null;
    const parent = fields.parent as {
      key?: string;
      fields?: { summary?: string; issuetype?: { name?: string } };
    } | null;

    let description: string | null = null;
    if (fields.description) {
      const raw = fields.description;
      if (typeof raw === "string") {
        description = raw.replace(/!\[.*?\]\(.*?\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
      } else {
        description = JSON.stringify(raw);
      }
    }

    const sprintArray = sprintField
      ? (fields[sprintField] as Array<{
          id?: number; name?: string; state?: string;
          boardId?: number; startDate?: string; endDate?: string;
        }> | null)
      : null;
    const activeSprint = sprintArray?.find((s) => s.state === "active") ?? sprintArray?.[0] ?? null;

    return {
      key: i.key as string,
      summary: (fields.summary as string) || "",
      status: status?.name || "Unknown",
      statusCategory: status?.statusCategory?.name || "Unknown",
      statusCategoryChangedDate: (fields.statuscategorychangedate as string) || null,
      priority: priority?.name || "None",
      assignee: assignee?.displayName || null,
      issueType: issueType?.name || "Unknown",
      parent: parent
        ? {
            key: parent.key || "",
            summary: parent.fields?.summary || "",
            issueType: parent.fields?.issuetype?.name || "",
          }
        : null,
      description,
      sprint: activeSprint
        ? {
            id: activeSprint.id || 0,
            name: activeSprint.name || "",
            state: activeSprint.state || "",
            boardId: activeSprint.boardId || 0,
            startDate: activeSprint.startDate || null,
            endDate: activeSprint.endDate || null,
          }
        : null,
    };
  });
}

/**
 * Walks parent chain up to a target issue type.
 * Resolves locally first (from issues already in the array), then
 * batch-fetches any remaining intermediates from Jira.
 */
export async function resolveParents(
  issues: JiraIssue[],
  targetType: string,
  cloudId: string,
): Promise<JiraIssue[]> {
  const issueMap = new Map<string, JiraIssue>();
  for (const issue of issues) {
    issueMap.set(issue.key, issue);
  }

  const needsResolution = new Set<string>();
  for (const issue of issues) {
    if (!issue.parent || issue.parent.issueType === targetType) continue;
    const local = issueMap.get(issue.parent.key);
    if (local?.parent) continue;
    needsResolution.add(issue.parent.key);
  }

  const fetchedParents = new Map<string, { key: string; summary: string; issueType: string }>();
  if (needsResolution.size > 0) {
    const keys = [...needsResolution];
    for (let i = 0; i < keys.length; i += 20) {
      const batch = keys.slice(i, i + 20);
      const jql = `key in (${batch.join(",")})`;
      try {
        const result = await callJiraTool("searchJiraIssuesUsingJql", {
          cloudId,
          jql,
          maxResults: 100,
          fields: ["summary", "issuetype", "parent"],
        });

        if (!result.isError) {
          const raw = extractTextContent(result) as { issues?: unknown[] };
          if (raw.issues && Array.isArray(raw.issues)) {
            for (const item of raw.issues) {
              const r = item as Record<string, unknown>;
              const fields = r.fields as Record<string, unknown>;
              const parent = fields.parent as {
                key?: string;
                fields?: { summary?: string; issuetype?: { name?: string } };
              } | null;

              if (parent?.key) {
                fetchedParents.set(r.key as string, {
                  key: parent.key,
                  summary: parent.fields?.summary || "",
                  issueType: parent.fields?.issuetype?.name || targetType,
                });
              }
            }
          }
        }
      } catch {
        // Silently skip failed batches — issues keep their intermediate parent
      }
    }
  }

  return issues.map((issue) => {
    if (!issue.parent || issue.parent.issueType === targetType) return issue;

    const local = issueMap.get(issue.parent.key);
    if (local?.parent?.issueType === targetType) {
      return { ...issue, parent: local.parent };
    }

    const fetched = fetchedParents.get(issue.parent.key);
    if (fetched) return { ...issue, parent: fetched };

    return issue;
  });
}

export const searchIssuesTool: Tool = {
  name: "search_jira_issues",
  description: "Search Jira issues using JQL. Optionally resolves parents up to a target issue type (e.g. Epic). The LLM receives a summary; full data is in the tool call log.",
  parameters: {
    type: "object",
    properties: {
      jql: { type: "string", description: "JQL query to execute" },
      resolveParentsTo: {
        type: "string",
        description: "Walk parent chain up to this issue type (e.g. 'Epic'). Omit to skip parent resolution.",
      },
      maxResults: { type: "number", description: "Max issues to return (default 100)" },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "Fields to fetch (default: summary, status, priority, assignee, issuetype, parent, description)",
      },
    },
    required: ["jql"],
  },

  async execute(args, context: ExecutionContext) {
    const { jql, resolveParentsTo, maxResults = 100, fields } = args as {
      jql: string;
      resolveParentsTo?: string;
      maxResults?: number;
      fields?: string[];
    };

    // Build default fields from BASE_FIELDS + any custom fields from config
    const configFields = context.config.fields as Record<string, string> | undefined;
    const sprintField = configFields?.sprint;
    const defaultFields = sprintField ? [...BASE_FIELDS, sprintField] : BASE_FIELDS;

    const result = await callJiraTool("searchJiraIssuesUsingJql", {
      cloudId: context.config.cloudId as string,
      jql,
      maxResults,
      fields: fields ?? defaultFields,
    });

    if (result.isError) {
      throw new Error(`searchJiraIssuesUsingJql failed: ${JSON.stringify(result.content)}`);
    }

    const raw = extractTextContent(result);
    const parsed = parseJiraIssues(raw, { sprintFieldId: sprintField });

    let issues: JiraIssue[];

    if (resolveParentsTo) {
      issues = await resolveParents(parsed, resolveParentsTo, context.config.cloudId as string);
    } else {
      issues = parsed;
    }

    // Extract sprint names for the summary
    const sprintNames = [...new Set(
      issues.map((i) => i.sprint?.name).filter(Boolean) as string[],
    )];
    const sprintNote = sprintNames.length > 0 ? ` in ${sprintNames.join(", ")}` : "";
    const parentNote = resolveParentsTo ? ` (parents resolved to ${resolveParentsTo})` : "";

    // Extract unique epic keys when parent resolution was used
    const epicKeys = resolveParentsTo
      ? [...new Set(
          issues.map((i) => i.parent?.issueType === resolveParentsTo ? i.parent.key : null).filter(Boolean) as string[],
        )]
      : [];
    const epicNote = epicKeys.length > 0 ? ` Epics: ${epicKeys.join(", ")}.` : "";

    const summaryNote = `Found ${issues.length} issues${sprintNote}${parentNote}.${epicNote}`;

    return { issues, total: issues.length, jql, sprintNames, epicKeys, summary: summaryNote };
  },
};
