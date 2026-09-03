/**
 * QA queue rebucketing for assignee-grouped sprint narratives.
 * Moves dev-assigned QA-status tickets into QA engineers' Not Started sections.
 */

import type { GroupIssuesResult, IssueGroup } from "../tools/jira/group-issues.js";
import type { RosterEntry } from "../tools/roster/types.js";
import type { JiraIssue } from "../tools/jira/search-issues.js";
import { assigneeHasRole, isQaStatus } from "./roster-roles.js";

function cloneGrouped(grouped: GroupIssuesResult): GroupIssuesResult {
  return JSON.parse(JSON.stringify(grouped)) as GroupIssuesResult;
}

function epicKeyFromIssue(issue: JiraIssue): string {
  if (issue.parent?.issueType === "Epic") return issue.parent.key;
  return "_no_epic_";
}

function epicLabelFromIssue(issue: JiraIssue): string {
  if (issue.parent?.issueType === "Epic") return issue.parent.summary;
  return "Other Work";
}

function listQaRosterEntries(roster: RosterEntry[]): RosterEntry[] {
  return roster.filter((e) => e.roles?.includes("qa"));
}

function isQueueCandidate(issue: JiraIssue, roster: RosterEntry[]): boolean {
  return isQaStatus(issue.status) && !assigneeHasRole(issue.assignee, "qa", roster);
}

function assigneeGroupKey(issue: JiraIssue): string {
  return issue.assignee || "_unassigned_";
}

function removeIssueByKey(issues: JiraIssue[], key: string): JiraIssue[] {
  return issues.filter((i) => i.key !== key);
}

function findAssigneeGroup(groups: IssueGroup[], assigneeKey: string): IssueGroup | undefined {
  return groups.find((g) => g.groupKey === assigneeKey);
}

function findOrCreateStatusSub(
  group: IssueGroup,
  statusKey: string,
  statusLabel: string,
): IssueGroup {
  if (!group.subGroups) group.subGroups = [];
  let sub = group.subGroups.find((s) => s.groupKey === statusKey);
  if (!sub) {
    sub = { groupKey: statusKey, groupLabel: statusLabel, issues: [] };
    group.subGroups.push(sub);
  }
  return sub;
}

function findOrCreateEpicSub(
  statusSub: IssueGroup,
  epicKey: string,
  epicLabel: string,
): IssueGroup {
  if (!statusSub.subGroups) statusSub.subGroups = [];
  let sub = statusSub.subGroups.find((s) => s.groupKey === epicKey);
  if (!sub) {
    sub = { groupKey: epicKey, groupLabel: epicLabel, issues: [] };
    statusSub.subGroups.push(sub);
  }
  return sub;
}

function collectInProgressQueueCandidates(
  groups: IssueGroup[],
  roster: RosterEntry[],
  hasEpicLevel: boolean,
): JiraIssue[] {
  const candidates: JiraIssue[] = [];
  const seen = new Set<string>();

  for (const assigneeGroup of groups) {
    if (!assigneeGroup.subGroups) continue;
    const inProgress = assigneeGroup.subGroups.find((s) => s.groupKey === "in_progress");
    if (!inProgress) continue;

    const issues =
      hasEpicLevel && inProgress.subGroups?.length
        ? inProgress.subGroups.flatMap((e) => e.issues)
        : inProgress.issues;

    for (const issue of issues) {
      if (isQueueCandidate(issue, roster) && !seen.has(issue.key)) {
        seen.add(issue.key);
        candidates.push(issue);
      }
    }
  }

  return candidates;
}

function removeIssueFromAssigneeInProgress(
  groups: IssueGroup[],
  assigneeKey: string,
  issueKey: string,
  hasEpicLevel: boolean,
): void {
  const assigneeGroup = findAssigneeGroup(groups, assigneeKey);
  if (!assigneeGroup?.subGroups) return;

  const inProgress = assigneeGroup.subGroups.find((s) => s.groupKey === "in_progress");
  if (!inProgress) return;

  if (hasEpicLevel && inProgress.subGroups) {
    for (const epicSub of inProgress.subGroups) {
      epicSub.issues = removeIssueByKey(epicSub.issues, issueKey);
    }
    inProgress.subGroups = inProgress.subGroups.filter((s) => s.issues.length > 0);
  }

  inProgress.issues = removeIssueByKey(inProgress.issues, issueKey);
  assigneeGroup.issues = removeIssueByKey(assigneeGroup.issues, issueKey);

  if (inProgress.issues.length === 0) {
    assigneeGroup.subGroups = assigneeGroup.subGroups.filter((s) => s.groupKey !== "in_progress");
  }
}

function addIssueToQaNotStarted(
  groups: IssueGroup[],
  qaDisplayName: string,
  issue: JiraIssue,
  hasEpicLevel: boolean,
): void {
  let assigneeGroup = findAssigneeGroup(groups, qaDisplayName);
  if (!assigneeGroup) {
    assigneeGroup = { groupKey: qaDisplayName, groupLabel: qaDisplayName, issues: [] };
    groups.push(assigneeGroup);
  }

  const notStarted = findOrCreateStatusSub(assigneeGroup, "not_started", "Not Started");

  if (hasEpicLevel) {
    const epicSub = findOrCreateEpicSub(
      notStarted,
      epicKeyFromIssue(issue),
      epicLabelFromIssue(issue),
    );
    if (!epicSub.issues.some((i) => i.key === issue.key)) {
      epicSub.issues.push(issue);
    }
  }

  if (!notStarted.issues.some((i) => i.key === issue.key)) {
    notStarted.issues.push(issue);
  }
  if (!assigneeGroup.issues.some((i) => i.key === issue.key)) {
    assigneeGroup.issues.push(issue);
  }
}

/**
 * Rebucket dev-assigned QA tickets into QA engineers' Not Started queues.
 * Returns a new GroupIssuesResult; does not mutate the input.
 */
export function applyQaQueueRebucket(
  grouped: GroupIssuesResult,
  roster: RosterEntry[],
): GroupIssuesResult {
  if (grouped.groupBy[0] !== "assignee") return grouped;

  const qaEntries = listQaRosterEntries(roster);
  if (qaEntries.length === 0) return grouped;

  const hasEpicLevel = grouped.groupBy.length >= 3 && grouped.groupBy[2] === "epic";
  const candidates = collectInProgressQueueCandidates(grouped.groups, roster, hasEpicLevel);
  if (candidates.length === 0) return grouped;

  const result = cloneGrouped(grouped);

  for (const issue of candidates) {
    removeIssueFromAssigneeInProgress(
      result.groups,
      assigneeGroupKey(issue),
      issue.key,
      hasEpicLevel,
    );

    for (const qaEntry of qaEntries) {
      addIssueToQaNotStarted(result.groups, qaEntry.displayName, issue, hasEpicLevel);
    }
  }

  return result;
}
