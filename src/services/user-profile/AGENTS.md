# src/services/user-profile/

## Purpose

User profile subsystem. Learns preferences, behavioral patterns, and workflows from session history and stores them per-user for personalized context injection into agent conversations.

## Ownership

- `types.ts` — Profile types: `UserProfilePreference` (category, description, confidence, evidence, lastUpdated), `UserProfilePattern`, `UserProfileWorkflow`, `UserProfileData` (preferences + patterns + workflows), `UserProfile`, `UserProfileChangelog`
- `user-profile-manager.ts` — `UserProfileManager`. Profile CRUD, merge, versioning, and confidence decay. Owns `user-profiles.db` (under `storagePath`), created via `connectionManager.getConnection`. Cap `maxPreferences`/`maxPatterns`/`maxWorkflows` from config; confidence decays after `userProfileConfidenceDecayDays`; changelog retained up to `userProfileChangelogRetentionCount`
- `profile-context.ts` — Profile context extraction for injection (used by `services/context.ts` when `injectProfile` is enabled)

## Local Contracts

- Profile data is keyed by user identity (`userName`/`userEmail`, overridable via `userEmailOverride`/`userNameOverride` in config)
- All DB access goes through `connectionManager` — this module opens no SQLite handles directly (it reuses the connection for `user-profiles.db`)
- `UserProfileData` is the stable shape injected into prompts; widening it requires updating `profile-context.ts` and the `max*` caps in config
- `UserProfileChangelog` retention is bounded by `userProfileChangelogRetentionCount` (default 5) — do not let it grow unbounded

## Work Guidance

- Profile learning is triggered by `services/user-memory-learning.ts` `performUserProfileLearning`, which runs on session idle at the interval set by `userProfileAnalysisInterval`
- Injected profile items are capped at `maxProfileItems` (default 5) — `profile-context.ts` selects the top items by confidence
- New profile categories extend `UserProfilePreference.category`/`UserProfilePattern.category` as free-form strings; no fixed enum

## Verification

- `tests/profile-write.test.ts`, `tests/profile-context.test.ts`, `tests/user-profile-validator.test.ts`, `tests/profile-tool-runtime.test.ts`, `tests/user-memory-learning.test.ts`

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
