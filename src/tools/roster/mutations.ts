/**
 * Pure roster mutation logic — used by write_roster and tests.
 */

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
  | "remove_work_page";

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
}

function findEntry(roster: RosterFile, accountId: string): RosterEntry | undefined {
  return roster.resolved.find((r) => r.accountId === accountId);
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
    if (!entry.workPages) entry.workPages = [];
    const existing = entry.workPages.find((wp) => wp.page === page);
    if (existing) {
      const merged = [...new Set([...existing.epics, ...input.epics])];
      existing.epics = merged;
      return { success: true, message: `Updated work page epics for ${entry.displayName}` };
    }
    entry.workPages.push({ page, epics: [...input.epics] });
    return { success: true, message: `Added work page for ${entry.displayName}` };
  }

  if (action === "remove_work_page") {
    const entry = findEntry(roster, accountId);
    if (!entry) {
      return { success: false, message: `Account ${accountId} not found in roster` };
    }
    if (!input.page?.trim()) {
      return { success: false, message: "page is required for remove_work_page" };
    }
    const page = input.page.trim();
    const before = entry.workPages?.length ?? 0;
    entry.workPages = (entry.workPages ?? []).filter((wp) => wp.page !== page);
    if ((entry.workPages?.length ?? 0) === before) {
      return { success: false, message: `Work page not found for ${entry.displayName}` };
    }
    if (entry.workPages?.length === 0) delete entry.workPages;
    return { success: true, message: `Removed work page for ${entry.displayName}` };
  }

  return { success: false, message: `Unknown action: ${action}` };
}
