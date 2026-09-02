# Epic Notion Cascade

## Purpose

When a sprint narrative run detects changes, regenerate assignee epic work pages in Notion for affected roster members. Roster entries carry Jira identity plus Notion work-page URLs and optional Slack channel IDs.

## Requirements

### Requirement: Extended Roster

The system SHALL store per-member publishing configuration in `roster.json` alongside Jira identity fields.

#### Scenario: Roster entry with work pages [tested]
- GIVEN a roster entry with `notion.homepageUrl`, `slack.channelId`, and `workPages`
- WHEN read_roster is called
- THEN all fields are returned for each resolved entry

#### Scenario: Work page shape [tested]
- GIVEN a work page entry `{ page: "<url>", epics: ["INS-900", "INS-1050"] }`
- WHEN the entry is stored on a roster member
- THEN one Notion page URL MAY map to one or more epic keys
- AND MVP usage is typically one epic per page

#### Scenario: write_roster sets publishing fields [tested]
- GIVEN an existing roster entry identified by accountId
- WHEN write_roster is called with action `set_notion`, `set_slack`, `add_work_page`, or `remove_work_page`
- THEN the corresponding fields are updated on that entry
- AND other roster fields are preserved

#### Scenario: Example roster committed [tested]
- GIVEN `roster.example.json`
- WHEN a developer sets up a new environment
- THEN the example shows optional `notion`, `slack`, and `workPages` fields with placeholder URLs

### Requirement: Assignee Account ID on Issues

The system SHALL persist Jira assignee account IDs on search results and snapshot cache entries.

#### Scenario: Search result includes account ID [tested]
- WHEN search_jira_issues parses issue fields
- THEN each issue includes `assigneeAccountId` (string or null) in addition to assignee display name

#### Scenario: Snapshot stores account ID [tested]
- WHEN jira_search_snapshots saves a search result
- THEN each cached issue includes `assigneeAccountId`

### Requirement: Assignee Change Detection

The system SHALL detect assignee changes in snapshot diffs the same way parent changes are detected.

#### Scenario: Assignee change in diff [tested]
- GIVEN a ticket moved from assignee A to assignee B between baseline and fresh snapshots
- WHEN jira_search_snapshots diff runs
- THEN `assigneeChanges` includes `{ key, was: A, now: B }` using account IDs

#### Scenario: Unassigned transition [tested]
- GIVEN a ticket that gained or lost an assignee
- WHEN jira_search_snapshots diff runs
- THEN `assigneeChanges` records `was` or `now` as null as appropriate

#### Scenario: Legacy baseline assignee backfill [tested]
- GIVEN a baseline snapshot saved before `assigneeAccountId` existed on cached issues
- AND the fresh snapshot includes `assigneeAccountId` for the same assignee display name
- WHEN jira_search_snapshots diff runs
- THEN no assignee change is recorded for that issue

#### Scenario: Diff block includes assignee changes [tested]
- GIVEN assignee changes in the diff result
- WHEN formatDiffBlock renders the diff
- THEN assignee changes appear in the markdown summary

### Requirement: Cascade Target Derivation

The system SHALL derive `(assigneeAccountId, epicKey)` update targets from the sprint diff and baseline snapshot.

#### Scenario: Status or added change [tested]
- GIVEN a ticket appears in diff `added` or `statusChanges`
- WHEN cascade targets are derived
- THEN a target is added for `(nowAssigneeAccountId, nowEpicKey)` from the fresh issue

#### Scenario: Removed ticket [tested]
- GIVEN a ticket appears in diff `removed`
- WHEN cascade targets are derived from the baseline snapshot
- THEN a target is added for `(baselineAssigneeAccountId, baselineEpicKey)`

#### Scenario: Parent change [tested]
- GIVEN a ticket appears in diff `parentChanges`
- WHEN cascade targets are derived
- THEN targets are added for `(assigneeAccountId, wasEpicKey)` and `(assigneeAccountId, nowEpicKey)`

#### Scenario: Assignee change [tested]
- GIVEN a ticket appears in diff `assigneeChanges`
- WHEN cascade targets are derived
- THEN targets are added for `(wasAssigneeAccountId, epicKey)` and `(nowAssigneeAccountId, epicKey)`

#### Scenario: Unassigned changed ticket [tested]
- GIVEN a changed ticket has no assignee account ID
- WHEN cascade targets are derived
- THEN no target is added for that ticket
- AND the ticket key is recorded in a `unassigned` log list

#### Scenario: Dedupe by work page [tested]
- GIVEN multiple epic keys on the same roster work page entry changed for one assignee
- WHEN cascade targets are grouped for execution
- THEN one regeneration is scheduled per `(assigneeAccountId, pageUrl)`
- AND `build_epic_jql` is called with all epic keys listed on that work page entry

### Requirement: Target Resolution

The system SHALL resolve cascade targets against the roster and work page mappings before execution.

#### Scenario: Missing roster member [tested]
- GIVEN a derived target assignee is not on the roster
- WHEN cascade target resolution runs
- THEN the tool throws an error listing the assignee and epic key
- AND no LLM calls or Notion updates are made

#### Scenario: Missing work page mapping [tested]
- GIVEN a roster member has no workPages entry whose `epics` array contains the epic key
- WHEN cascade target resolution runs
- THEN that assignee×epic pair is skipped
- AND the pair is recorded in `notCreated` with reason `"not created"`
- AND other mapped targets continue to execute

#### Scenario: All targets resolved [tested]
- GIVEN every non-unassigned target has a roster entry
- WHEN cascade target resolution runs
- THEN mapped targets proceed to execution
- AND unmapped targets appear only in `notCreated`

### Requirement: Epic Cascade Execution

The system SHALL regenerate and publish epic narratives to Notion using the sprint diff as the sole change trigger.

#### Scenario: No epic diff gate [tested]
- GIVEN cascade execution is triggered by a sprint diff with changes
- WHEN an epic work page is regenerated
- THEN jira_search_snapshots diff is NOT used as an early-exit gate for that epic JQL
- AND the epic snapshot is saved after search

#### Scenario: Full epic view [tested]
- GIVEN the sprint JQL used a statusCategories filter
- WHEN build_epic_jql runs for a cascade target
- THEN statusCategories is omitted
- AND all non-closed child issues for the assignee and epic keys are included

#### Scenario: Per-page pipeline [tested]
- GIVEN a scheduled `(assigneeAccountId, pageUrl)` target
- WHEN cascade executes that target
- THEN it runs build_epic_jql → search_jira_issues → jira_search_snapshots save → group_issues(status) → generate_epic_narrative → update_notion_page with full narrative content (replace_content)

#### Scenario: Empty epic page skip [tested]
- GIVEN an assignee has zero non-closed child issues for the epic keys on a work page
- WHEN cascade executes that target
- THEN no LLM call is made
- AND no Notion update is made
- AND the target appears in the skipped list with reason "no open work"

#### Scenario: Notion full replace [tested]
- GIVEN generate_epic_narrative produced markdown for a target
- WHEN update_notion_page runs for the work page URL
- THEN Notion MCP replace_content is called with the full narrative body

### Requirement: Sprint Skill Integration

The sprint-narrative skill SHALL cascade epic Notion updates after generating the sprint narrative when the sprint diff shows changes.

#### Scenario: Changed sprint diff [tested]
- GIVEN jira_search_snapshots diff reports changes (or first run with no baseline)
- WHEN the sprint-narrative skill continues past the diff step
- THEN cascade_epic_notion_updates is called after generate_sprint_narrative (and after optional sprint Notion update)

#### Scenario: Unchanged sprint diff [tested]
- GIVEN jira_search_snapshots diff reports "No changes since …"
- WHEN the sprint-narrative skill runs
- THEN cascade_epic_notion_updates is NOT called
- AND the skill stops as today

#### Scenario: Explicit regenerate defers full epic refresh [tested]
- GIVEN the user asked to regenerate all sprint prose from scratch
- WHEN the sprint-narrative skill runs
- THEN epic cascade behavior is unchanged (still driven by sprint diff only)
- AND the skill does NOT add a standalone refresh-all-epic-pages path

### Requirement: Cascade Reporting

The system SHALL return a structured summary from cascade execution.

#### Scenario: Summary fields [tested]
- WHEN cascade_epic_notion_updates completes
- THEN the result includes lists of updated pages (assignee, page URL, epic keys), skipped pages (with reason), notCreated pairs (assignee, epic key, reason `"not created"`), and unassigned ticket keys logged

#### Scenario: Unknown assignee fails run [tested]
- GIVEN a derived target assignee is not on the roster
- WHEN cascade_epic_notion_updates is called
- THEN the tool throws before any Notion update
- AND no pages were updated
