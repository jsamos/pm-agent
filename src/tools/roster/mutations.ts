/**
 * Pure roster mutation logic — used by write_roster and tests.
 */

import { findWorkPageByRef } from "../../lib/roster-work-pages.js";
import type {
  RosterEntry,
  RosterFile,
  RosterNotionConfig,
  RosterSlackConfig,
  RosterWorkPage,
} from "./types.js";

export type WriteRosterAction =
  | "add"
  | "remove"
  | "set_roles"
  | "set_notion"
  | "set_slack"
  | "add_work_page"
  | "remove_work_page"
  | "remove_epics_from_work_page"
  | "set_work_page_name";

export interface WriteRosterInput {
  action: WriteRosterAction;
  accountId: string;
  name?: string;
  shortName?: string;
  displayName?: string;
  roles?: string[];
  homepageUrl?: string;
  channelId?: string;
  page?: string;
  epics?: string[];
  notion?: RosterNotionConfig;
  slack?: RosterSlackConfig;
  workPages?: RosterWorkPage[];
}

export interface WriteRosterResult {
  success: boolean;
  message: string;
  total?: number;
  roles?: string[];
  warning?: string;
}

function findEntry(roster: RosterFile, accountId: string): RosterEntry | undefined {
  return roster.resolved.find((r) => r.accountId === accountId);
}

function pruneEmptyWorkPages(entry: RosterEntry): void {
  if (entry.workPages?.length === 0) delete entry.workPages;
}

function workPageNotFoundMessage(displayName: string): string {
  return `Work page not found for ${displayName}`;
}

function collectDuplicateEpicWarnings(
  entry: RosterEntry,
  targetPageUrl: string,
  epics: string[],
): string | undefined {
  const warnings: string[] = [];
  for (const epic of epics) {
    for (const wp of entry.workPages ?? []) {
      if (wp.page !== targetPageUrl && wp.epics.includes(epic)) {
        const label = wp.name ?? wp.page;
        warnings.push(`${epic} was already mapped on ${label}`);
      }
    }
  }
  return warnings.length > 0 ? warnings.join("; ") : undefined;
}

export function applyRosterWrite(roster: RosterFile, input: WriteRosterInput): WriteRosterResult {
  const { action, accountId } = input;

  if (action === "add") {
    const exists = findEntry(roster, accountId);
    if (exists) {
      return { success: true, message: `Already in roster: ${exists.displayName}` };
    }

    const { name, shortName, displayName, roles, notion, slack, workPages } = input;
    const entry: RosterEntry = {
      name: name || displayName || accountId,
      shortName: shortName || (name || "").split(" ")[0],
      accountId,
      displayName: displayName || name || accountId,
      ...(roles?.length ? { roles } : {}),
      ...(notion ? { notion } : {}),
      ...(slack ? { slack } : {}),
      ...(workPages?.length ? { workPages } : {}),
    };
    roster.resolved.push(entry);
    return { success: true, message: `Added ${entry.displayName}`, total: roster.resolved.length };
  }

  if (action === "remove") {
    const before = roster.resolved.length;
    roster.resolved = roster.resolved.filter((r) => r.accountId !== accountId);
    if (roster.resolved.length === before) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    return { success: true, message: "Removed", total: roster.resolved.length };
  }

  if (action === "set_roles") {
    const entry = findEntry(roster, accountId);
    if (!entry) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    entry.roles = input.roles ?? [];
    return {
      success: true,
      message: `Updated roles for ${entry.displayName}`,
      roles: entry.roles,
    };
  }

  if (action === "set_notion") {
    const entry = findEntry(roster, accountId);
    if (!entry) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    if (!input.homepageUrl?.trim()) {
      return { success: false, message: "homepageUrl is required for set_notion" };
    }
    entry.notion = { homepageUrl: input.homepageUrl.trim() };
    return { success: true, message: `Updated Notion homepage for ${entry.displayName}` };
  }

  if (action === "set_slack") {
    const entry = findEntry(roster, accountId);
    if (!entry) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    if (!input.channelId?.trim()) {
      return { success: false, message: "channelId is required for set_slack" };
    }
    entry.slack = { channelId: input.channelId.trim() };
    return { success: true, message: `Updated Slack channel for ${entry.displayName}` };
  }

  if (action === "add_work_page") {
    const entry = findEntry(roster, accountId);
    if (!entry) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    if (!input.page?.trim()) {
      return { success: false, message: "page is required for add_work_page" };
    }
    if (!input.epics?.length) {
      return { success: false, message: "epics must be a non-empty array for add_work_page" };
    }
    const page = input.page.trim();
    const pageLabel = input.name?.trim();
    if (!entry.workPages) entry.workPages = [];

    const warning = collectDuplicateEpicWarnings(entry, page, input.epics);
    const existing = entry.workPages.find((wp) => wp.page === page);
    if (existing) {
      existing.epics = [...new Set([...existing.epics, ...input.epics])];
      if (pageLabel) existing.name = pageLabel;
      return {
        success: true,
        message: `Updated work page epics for ${entry.displayName}`,
        ...(warning ? { warning } : {}),
      };
    }
    entry.workPages.push({
      page,
      epics: [...input.epics],
      ...(pageLabel ? { name: pageLabel } : {}),
    });
    return {
      success: true,
      message: `Added work page for ${entry.displayName}`,
      ...(warning ? { warning } : {}),
    };
  }

  if (action === "remove_work_page") {
    const entry = findEntry(roster, accountId);
    if (!entry) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    if (!input.page?.trim()) {
      return { success: false, message: "page is required for remove_work_page" };
    }
    const matched = findWorkPageByRef(entry, input.page.trim());
    if (!matched) {
      return { success: false, message: workPageNotFoundMessage(entry.displayName) };
    }
    entry.workPages = (entry.workPages ?? []).filter((wp) => wp.page !== matched.page);
    pruneEmptyWorkPages(entry);
    return { success: true, message: `Removed work page for ${entry.displayName}` };
  }

  if (action === "remove_epics_from_work_page") {
    const entry = findEntry(roster, accountId);
    if (!entry) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    if (!input.page?.trim()) {
      return { success: false, message: "page is required for remove_epics_from_work_page" };
    }
    if (!input.epics?.length) {
      return { success: false, message: "epics must be a non-empty array for remove_epics_from_work_page" };
    }
    const matched = findWorkPageByRef(entry, input.page.trim());
    if (!matched) {
      return { success: false, message: workPageNotFoundMessage(entry.displayName) };
    }
    const removeSet = new Set(input.epics);
    matched.epics = matched.epics.filter((e) => !removeSet.has(e));
    if (matched.epics.length === 0) {
      entry.workPages = (entry.workPages ?? []).filter((wp) => wp.page !== matched.page);
      pruneEmptyWorkPages(entry);
      return { success: true, message: `Removed work page for ${entry.displayName}` };
    }
    return { success: true, message: `Updated work page epics for ${entry.displayName}` };
  }

  if (action === "set_work_page_name") {
    const entry = findEntry(roster, accountId);
    if (!entry) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    if (!input.page?.trim()) {
      return { success: false, message: "page is required for set_work_page_name" };
    }
    if (!input.name?.trim()) {
      return { success: false, message: "name is required for set_work_page_name" };
    }
    const matched = findWorkPageByRef(entry, input.page.trim());
    if (!matched) {
      return { success: false, message: workPageNotFoundMessage(entry.displayName) };
    }
    matched.name = input.name.trim();
    return { success: true, message: `Updated work page name for ${entry.displayName}` };
  }

  return { success: false, message: `Unknown action: ${action}` };
}
