# Smart Sprint Report Updates

## Purpose

Enable incremental sprint report generation by caching per-group narrative results and reusing them when the underlying tickets have not changed. When publishing to Notion, replace the full page with the assembled narrative (cached sections plus any freshly regenerated sections).

## Requirements

### Requirement: Narrative Cache

The system SHALL persist per-group narrative results after each sprint narrative generation.

#### Scenario: First run (no cache) [tested]

- GIVEN no prior narrative cache for this JQL thread
- WHEN generate_sprint_narrative completes
- THEN a cache entry is written containing each group's key, label, issue keys, LLM prose, and rendered markdown
- AND the output is identical to current behavior

#### Scenario: Subsequent run with cache [tested]

- GIVEN a narrative cache entry exists for this JQL thread
- WHEN generate_sprint_narrative runs
- THEN the cache is loaded and available for selective regeneration

#### Scenario: Cache keying [tested]

- GIVEN a JQL query producing a thread hash
- WHEN narrative cache is loaded
- THEN the most recent entry with a matching thread hash is returned
- AND entries with different thread hashes are ignored

#### Scenario: GroupBy mismatch [tested]

- GIVEN a cached entry with groupBy ["epic", "status"]
- WHEN the current run uses groupBy ["assignee", "status", "epic"]
- THEN the cache is treated as a miss and full regeneration occurs

### Requirement: Narrative Cache Management

The system SHALL allow removing cached narrative entries without regenerating a report.

#### Scenario: Clear all narrative cache [tested]

- WHEN jira_narrative_cache is called with action "clear"
- THEN all narrative cache entries are deleted

#### Scenario: Remove by JQL thread [tested]

- GIVEN narrative cache entries for thread A and thread B
- WHEN jira_narrative_cache is called with action "remove_thread" and thread A
- THEN all entries for thread A are deleted
- AND entries for thread B remain

#### Scenario: Prose regen clears cached entries [tested]

- GIVEN the user asked to regenerate narrative prose from scratch (e.g. "regenerate", "refresh narrative", "ignore cache")
- WHEN the sprint-narrative skill runs
- THEN the skill instructs calling jira_narrative_cache remove_thread for the current JQL thread before generate_sprint_narrative
- AND a Notion "full rewrite" alone does NOT trigger remove_thread

### Requirement: Selective Regeneration

The system SHALL skip LLM calls for groups whose tickets have not changed since the last run.

#### Scenario: Unchanged group [tested]

- GIVEN a group where none of its issue keys appear in the diff's added, removed, or statusChanges sets
- AND the group exists in the narrative cache
- WHEN generate_sprint_narrative processes this group
- THEN the cached prose is reused without an LLM call

#### Scenario: Changed group [tested]

- GIVEN a group where at least one issue key appears in the diff's added, removed, or statusChanges sets
- WHEN generate_sprint_narrative processes this group
- THEN an LLM call is made to regenerate the prose

#### Scenario: New group (not in cache) [tested]

- GIVEN a group that exists in the current grouping but not in the narrative cache
- WHEN generate_sprint_narrative processes this group
- THEN an LLM call is made to generate the prose

#### Scenario: Removed group (in cache, not in current grouping) [tested]

- GIVEN a group that exists in the narrative cache but not in the current grouping
- WHEN generate_sprint_narrative assembles the output
- THEN the removed group is omitted from the final markdown

#### Scenario: Full override [tested]

- GIVEN the user says "regenerate", "rerun", "refresh", or "full"
- WHEN generate_sprint_narrative runs (without a diff entry in the tool call log)
- THEN the narrative cache is ignored and all groups are regenerated via LLM
- AND a fresh cache entry is written

Note: The orchestrator skips the diff step on "full" override, so no diff entry appears in the log. Without a diff, `buildDiffSignals` returns null, making `canReuse` false — all groups are regenerated.

#### Scenario: Diff block [tested]

- GIVEN a prior baseline exists
- WHEN generate_sprint_narrative assembles the output
- THEN the "Changes since..." diff block is always regenerated from the current diff regardless of cache

### Requirement: Notion Page Update

The system SHALL replace the full Notion page body with the assembled sprint narrative.

#### Scenario: Full page replace [tested]

- GIVEN generate_sprint_narrative has produced a narrative
- WHEN update_notion_page is called with contentFrom "generate_sprint_narrative"
- THEN the Notion MCP `replace_content` command is called with the full narrative as new_str

#### Scenario: Selective regen produces complete narrative [tested]

- GIVEN selective regeneration reused some groups from cache and regenerated others
- WHEN generate_sprint_narrative completes
- THEN the returned narrative contains both cached and fresh sections assembled into one markdown document suitable for a full Notion replace

### Requirement: Reporting

The system SHALL report which groups were regenerated and which were reused.

#### Scenario: Summary with selective regeneration [tested]

- GIVEN 5 groups total, 2 regenerated, 3 reused from cache
- WHEN generate_sprint_narrative returns its summary
- THEN the summary includes the LLM call count and reused count
