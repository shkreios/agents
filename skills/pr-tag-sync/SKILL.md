---
name: pr-tag-sync
description: Mirror Azure DevOps PR labels from the tags on their linked user stories (plan, review, apply).
disable-model-invocation: true
---

Mirrors pull request labels from the tags of their linked work items: a linked Task contributes its own tags plus its parent story's, a User Story or Bug counts directly, Features/Epics and parentless Tasks never contribute tags. Applying makes each PR's labels exactly match the approved set, deleting extras.

Two bundled scripts live in `scripts/` next to this SKILL.md. **Always invoke them by absolute path** (resolve from this file's location); Bun auto-installs their dependencies on first run. For ADO auth rules and REST caveats, follow the azure-devops skill.

## Steps

1. **Auth check**: run `az account show`. If it fails, halt and instruct the user to authenticate (they can run `! az login` in the prompt); never resolve auth problems yourself.
2. **Plan**: run `<skill-folder>/scripts/plan-pr-tags.ts` from inside the target repo. Defaults: active PRs, org/project/repo derived from the git remote. Flags: `--status`, `--repository`, `--project`, `--organization`, `--pr <id>` (repeatable). Output is JSON: a `plan` entry per PR (`changed`, `unchanged`, or `skipped` with a reason) and an `applyMap` of changed PRs to their final tag list.
3. **Present the plan**: show the user every `changed` PR as a table (PR, title, resolved stories, labels with `+added` and `-removed`), the unchanged count, and each `skipped` PR with its reason. Done only when every PR in the plan appears as changed, unchanged, or skipped with a reason.
4. **Approval gate**: wait for the user's explicit go-ahead. They may drop PRs or edit tags; apply those edits to the `applyMap`. Never call the apply script without an approval in this conversation.
5. **Apply**: write the approved map to a temp file and run `<skill-folder>/scripts/apply-pr-tags.ts <file>` (same org/project/repo flags if the defaults were overridden in step 2). Report the per-PR results, surfacing any `error` entries verbatim.
