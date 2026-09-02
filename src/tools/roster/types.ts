/**
 * Shared roster types — Jira identity plus optional publishing config.
 */

export interface RosterWorkPage {
  page: string;
  epics: string[];
}

export interface RosterNotionConfig {
  homepageUrl: string;
}

export interface RosterSlackConfig {
  channelId: string;
}

export interface RosterEntry {
  name: string;
  shortName: string;
  accountId: string;
  displayName: string;
  /** Optional roles — e.g. "qa" for QA engineers (see roster-roles.ts). */
  roles?: string[];
  notion?: RosterNotionConfig;
  slack?: RosterSlackConfig;
  workPages?: RosterWorkPage[];
}

export interface RosterFile {
  resolved: RosterEntry[];
  unresolved: string[];
  generatedAt: string;
}
