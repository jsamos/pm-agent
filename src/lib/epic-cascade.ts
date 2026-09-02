/**
 * Pure functions for deriving and resolving epic Notion cascade targets.
 */

import { findWorkPageEntry } from "./roster-work-pages.js";
import type { RosterEntry } from "../tools/roster/types.js";
import type { JiraIssue } from "../tools/jira/search-issues.js";
import type { DiffData } from "../tools/jira/format-diff.js";
import type { CachedIssue } from "../tools/jira/snapshots.js";

export interface CascadePair {
  assigneeAccountId: string;
  epicKey: string;
}

export interface CascadeWorkPageTarget {
  assigneeAccountId: string;
  assigneeDisplayName: string;
  pageUrl: string;
  epicKeys: string[];
}

export interface DeriveResult {
  pairs: CascadePair[];
  unassignedKeys: string[];
}

export interface NotCreatedTarget {
  assigneeAccountId: string;
  assigneeDisplayName: string;
  epicKey: string;
  reason: "not created";
}

type IssueLike = JiraIssue | CachedIssue;

function epicKeyFromIssue(issue: IssueLike): string | null {
  return issue.parent?.key ?? null;
}

function pairKey(assigneeAccountId: string, epicKey: string): string {
  return `${assigneeAccountId}|${epicKey}`;
}

function addPair(
  set: Map<string, CascadePair>,
  assigneeAccountId: string | null | undefined,
  epicKey: string | null,
  unassignedKeys: string[],
  issueKey: string,
): void {
  if (!assigneeAccountId) {
    unassignedKeys.push(issueKey);
    return;
  }
  if (!epicKey) return;
  set.set(pairKey(assigneeAccountId, epicKey), { assigneeAccountId, epicKey });
}

function issueByKey(issues: IssueLike[]): Map<string, IssueLike> {
  return new Map(issues.map((i) => [i.key, i]));
}

export function deriveCascadePairs(
  diff: DiffData,
  freshIssues: JiraIssue[],
  baselineIssues: CachedIssue[],
): DeriveResult {
  const freshMap = issueByKey(freshIssues);
  const baselineMap = issueByKey(baselineIssues);
  const pairs = new Map<string, CascadePair>();
  const unassignedKeys: string[] = [];

  for (const key of diff.added) {
    const issue = freshMap.get(key);
    if (!issue) continue;
    addPair(pairs, issue.assigneeAccountId, epicKeyFromIssue(issue), unassignedKeys, key);
  }

  for (const change of diff.statusChanges) {
    const issue = freshMap.get(change.key);
    if (!issue) continue;
    addPair(pairs, issue.assigneeAccountId, epicKeyFromIssue(issue), unassignedKeys, change.key);
  }

  for (const key of diff.removed) {
    const issue = baselineMap.get(key);
    if (!issue) continue;
    addPair(pairs, issue.assigneeAccountId as string | null, epicKeyFromIssue(issue), unassignedKeys, key);
  }

  for (const change of diff.parentChanges) {
    const issue = freshMap.get(change.key);
    if (!issue) continue;
    const assignee = issue.assigneeAccountId;
    if (!assignee) {
      unassignedKeys.push(change.key);
      continue;
    }
    if (change.was) pairs.set(pairKey(assignee, change.was), { assigneeAccountId: assignee, epicKey: change.was });
    if (change.now) pairs.set(pairKey(assignee, change.now), { assigneeAccountId: assignee, epicKey: change.now });
  }

  for (const change of diff.assigneeChanges) {
    const issue = freshMap.get(change.key);
    if (!issue) continue;
    const epicKey = epicKeyFromIssue(issue);
    if (!epicKey) continue;
    if (change.was) pairs.set(pairKey(change.was, epicKey), { assigneeAccountId: change.was, epicKey });
    if (change.now) pairs.set(pairKey(change.now, epicKey), { assigneeAccountId: change.now, epicKey });
  }

  return { pairs: [...pairs.values()], unassignedKeys: [...new Set(unassignedKeys)] };
}

export function validateRosterMembership(pairs: CascadePair[], roster: RosterEntry[]): void {
  const rosterIds = new Set(roster.map((r) => r.accountId));
  const unknown = [...new Set(pairs.map((p) => p.assigneeAccountId).filter((id) => !rosterIds.has(id)))];
  if (unknown.length > 0) {
    const details = pairs
      .filter((p) => unknown.includes(p.assigneeAccountId))
      .map((p) => `${p.epicKey} (assignee ${p.assigneeAccountId})`);
    throw new Error(`Unknown roster assignee(s): ${details.join(", ")}`);
  }
}

export function resolveWorkPageTargets(
  pairs: CascadePair[],
  roster: RosterEntry[],
): { targets: CascadeWorkPageTarget[]; notCreated: NotCreatedTarget[] } {
  const rosterById = new Map(roster.map((r) => [r.accountId, r]));
  const notCreated: NotCreatedTarget[] = [];
  const targetMap = new Map<string, CascadeWorkPageTarget>();

  for (const pair of pairs) {
    const entry = rosterById.get(pair.assigneeAccountId);
    if (!entry) continue;

    const workPage = findWorkPageEntry(entry, pair.epicKey);
    if (!workPage) {
      notCreated.push({
        assigneeAccountId: pair.assigneeAccountId,
        assigneeDisplayName: entry.displayName,
        epicKey: pair.epicKey,
        reason: "not created",
      });
      continue;
    }

    const targetKey = `${pair.assigneeAccountId}|${workPage.page}`;
    const existing = targetMap.get(targetKey);
    if (existing) continue;

    targetMap.set(targetKey, {
      assigneeAccountId: pair.assigneeAccountId,
      assigneeDisplayName: entry.displayName,
      pageUrl: workPage.page,
      epicKeys: [...workPage.epics],
    });
  }

  return { targets: [...targetMap.values()], notCreated };
}

/** Non-epic child issues returned by epic JQL (open work for narrative). */
export function countOpenWork(issues: JiraIssue[]): number {
  return issues.filter((i) => i.issueType !== "Epic").length;
}
