---
name: azure-devops
description: "Work with Azure DevOps via az CLI and REST API. Use when managing work items (create, update, query, comment), creating or reviewing pull requests (including PR comment threads), or inspecting pipeline runs and logs. Includes markdown-formatted work item fields and comments not supported by plain az."
---

## Bundled scripts

Two helper scripts live in `scripts/` next to this SKILL.md. **Always invoke them by absolute path** (resolve from this file's location) — never `./scripts/...`, which resolves against your cwd where the file does not exist. They are executable; Bun auto-installs their dependencies on first run.

- `az-boards-work-item-update-md.ts` — create/update work items with **Markdown**-formatted multiline fields: Description, Acceptance Criteria, or any field by reference name via `--field` (the az CLI cannot set `multilineFieldsFormat`).
- `az-boards-comment-md.ts` — add/update work item **comments** as Markdown (az has no comments command; plain REST stores comments as HTML).

## Auth: check first, never fix

Before the first operation in a session, verify the CLI is connected by running: `az account show`. If it fails, **halt** — instruct the user to authenticate (they can run `! az login` in the prompt) and wait. Never attempt to resolve authentication problems yourself: do not run `az login`, `az devops login`, `az devops logout`, or set `AZURE_DEVOPS_EXT_PAT` (an AAD access token is not a PAT; all of these have previously caused session issues).

One exception: after a successful `az account show`, if an `az devops` command fails with the transient error `Before you can run Azure DevOps commands, you need to run the login command...`, retry the identical command once (optionally adding `--detect false`). If it still fails, halt and notify the user to resolve authentication.

## REST calls

For endpoints the CLI doesn't cover:

- Prefer `az devops invoke` — it handles auth and URL-encodes project names.
- `az rest` works only with `--resource 499b84ac-1321-427f-aa17-267ca6975798` (the Azure DevOps AAD resource id) — without it you get sign-in HTML instead of JSON — and you must URL-encode spaces in the URI yourself.
- Raw `curl` with a bearer token from `az account get-access-token --resource 499b84ac-...` works for `wit` endpoints but is sometimes redirected to a sign-in page on `git` endpoints; fall back to `az devops invoke`.
- API version: `7.1` (work item comments: `7.1-preview.4`).

## Work items

`show` and `update` do NOT accept `--project` — work item IDs are unique per organization, so only `--org` is needed (from a URL `https://dev.azure.com/ORG/PROJECT/_workitems/edit/ID`, ORG and ID are all you need). Only `create` and `query` take `--project`. Querying the wrong org returns `TF401232: Work item does not exist, or you do not have permissions`.

```bash
az boards work-item show --id 12345 --org https://dev.azure.com/myorg

az boards work-item create --title "Task title" --type "User Story" \
  --project "MyProject" --org https://dev.azure.com/myorg \
  --assigned-to "user@domain.com" --area "Team/Area" --iteration "Sprint 1"

az boards work-item update --id 12345 --state "Active" \
  --fields "System.Tags=tag1; tag2" --org https://dev.azure.com/myorg
```

### Fields vary by type — check before writing

Which multiline fields a work item has depends on its type AND the project's process template: Tasks have no Acceptance Criteria; Bugs typically use `Microsoft.VSTS.TCM.ReproSteps` (and `Microsoft.VSTS.TCM.SystemInfo`) instead of Description/Acceptance Criteria; custom templates add their own. Before filling fields on a type you haven't already confirmed in this project, list the type's fields and pick the correct reference names:

```bash
az rest --method get --resource "499b84ac-1321-427f-aa17-267ca6975798" \
  --uri "https://dev.azure.com/ORG/PROJECT/_apis/wit/workitemtypes/Bug/fields?api-version=7.1" \
  --query "value[].referenceName" -o json
```

Choosing how to write formatted content:
- Plain `--description` accepts inline HTML and renders it.
- For **Markdown** fields, use the bundled script (below): `-d`/`--acceptance-criteria` for the standard pair, `--field <RefName>=<file-or-md>` (repeatable) for anything else, e.g. a Bug's Repro Steps. Once a field is set to Markdown it cannot revert to HTML.
- Comments always need the comment script or REST — there is no az command.

### Markdown fields (bundled script)

```bash
# Create — --title, --type, --project required; --org auto-detected from `az devops configure` if omitted
<skill-folder>/scripts/az-boards-work-item-update-md.ts create \
  --title "Implement feature X" --type "User Story" --project "MyProject" \
  --organization https://dev.azure.com/myorg \
  --description ./description.md --acceptance-criteria ./acceptance.md \
  --assigned-to "user@domain.com" --area "Team/Area" --iteration "Sprint 5"

# Update — id positional; -d/--description and --acceptance-criteria take a file path or inline markdown
<skill-folder>/scripts/az-boards-work-item-update-md.ts update 12345 -d ./desc.md

# Any other multiline field by reference name (repeatable) — e.g. a Bug's Repro Steps
<skill-folder>/scripts/az-boards-work-item-update-md.ts update 12346 \
  --field "Microsoft.VSTS.TCM.ReproSteps=./repro.md"
```

### Comments (bundled script)

```bash
<skill-folder>/scripts/az-boards-comment-md.ts add 12345 \
  --project "MyProject" --organization https://dev.azure.com/myorg \
  --text ./comment.md

<skill-folder>/scripts/az-boards-comment-md.ts update 12345 <commentId> \
  --project "MyProject" -t "## Heading\n\nInline **markdown**"
```

To @-mention someone, put `@<IDENTITY_GUID>` in the markdown (e.g. `@<93C1DD2F-26E5-6F29-B386-EEDA4F25D6DC>`) — it renders as a mention chip and notifies. Copy the token from an existing comment that tags that person. List comments (to find a comment id or mention token):

```bash
az rest --method get --resource "499b84ac-1321-427f-aa17-267ca6975798" \
  --uri "https://dev.azure.com/ORG/PROJECT/_apis/wit/workItems/12345/comments?api-version=7.1-preview.4"
```

### Query

JMESPath: field names containing dots MUST use escaped double quotes — `--query "fields.\"System.Title\""`. Both `fields.['System.Title']` (silently returns the literal string) and `fields.'System.Title'` (`invalid jmespath_type value`) fail. `--fields` cannot be combined with the default expand (`The expand parameter can not be used with the fields parameter`) — use `--query` on the JSON instead.

```bash
az boards query --org https://dev.azure.com/myorg --project "MyProject" \
  --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active'"

az boards work-item show --id 12345 --org https://dev.azure.com/myorg \
  --query "{id: id, title: fields.\"System.Title\", state: fields.\"System.State\"}" -o json
```

### Relations & types

```bash
az boards work-item relation add --id 12345 --relation-type "Parent" --target-id 67890 \
  --org https://dev.azure.com/myorg
# Relation types: Parent, Child, Related, Duplicate, Predecessor, Successor

# List a project's work item types (no az boards command exists for this)
az devops invoke --area wit --resource workitemtypes \
  --route-parameters project="MyProject" --org https://dev.azure.com/myorg --api-version 7.1
```

## Pull requests

Extract ORG, PROJECT, and REPO from `git remote get-url origin` (`https://dev.azure.com/ORG/PROJECT/_git/REPO`; URL-decode `%20` to spaces) — never discover them via `az devops project list`. Before creating: the source branch must exist on the remote (`git ls-remote --heads origin <branch>`; push with `-u` if not), and the description must be under 4000 characters.

```bash
az repos pr create \
  --source-branch feature/my-branch --target-branch develop \
  --title "PR Title" --description @description.md \
  --work-items 12345 \
  --organization https://dev.azure.com/ORG --project "PROJECT" --repository "REPO"
```

`--repository` is required despite the docs suggesting otherwise. `--description @file.md` and `"$(cat file.md)"` both preserve markdown verbatim.

```bash
az repos pr list --status active --organization https://dev.azure.com/ORG --project "PROJECT"
az repos pr show --id 123 --organization https://dev.azure.com/ORG
az repos pr set-vote --id 123 --vote approve --organization https://dev.azure.com/ORG
az repos pr update --id 123 --status completed --organization https://dev.azure.com/ORG
az repos pr reviewer add --id 123 --reviewers user@domain.com --organization https://dev.azure.com/ORG
```

Identity filters (`--creator`, `--reviewers`, `--assigned-to`) need the organization's ADO identity email, which may differ from the local git email (`Could not resolve identity` otherwise). To find it, list without the filter and read `createdBy.uniqueName`.

### PR comment threads

No az command exists — use REST. Markdown renders in `content`.

```bash
# PR-level comment thread
az rest --method post --resource "499b84ac-1321-427f-aa17-267ca6975798" \
  --uri "https://dev.azure.com/ORG/PROJECT/_apis/git/repositories/REPO/pullRequests/123/threads?api-version=7.1" \
  --headers "Content-Type=application/json" --body @thread.json
```

`thread.json` (status 1 = active):

```json
{
  "comments": [{ "parentCommentId": 0, "content": "Review **markdown** here", "commentType": 1 }],
  "status": 1
}
```

For an inline (file-anchored) comment, add to the body:

```json
"threadContext": {
  "filePath": "/src/services/foo.ts",
  "rightFileStart": { "line": 42, "offset": 1 },
  "rightFileEnd": { "line": 45, "offset": 1 }
}
```

Edit / delete a comment: `az rest --method patch|delete --resource "499b84ac-..." --uri ".../pullRequests/123/threads/<threadId>/comments/1?api-version=7.1"` (patch body: `{"content": "updated markdown"}`). For large payloads, `az devops invoke --area git --resource pullRequestThreads --route-parameters project="PROJECT" repositoryId=<repo-guid> --in-file payload.json` also works (repo guid: `az repos show --repository REPO --query id -o tsv`).

## Pipelines

```bash
az pipelines list --organization https://dev.azure.com/ORG --project "PROJECT"
az pipelines run --id 42 --organization https://dev.azure.com/ORG --project "PROJECT"
az pipelines runs show --id 12345 --organization https://dev.azure.com/ORG --project "PROJECT"
```

`az pipelines` does not expose stage/timeline/log detail, and `configuration.path` in list/show is always `null`. Use `az devops invoke` (it URL-encodes project names; raw `az rest --url` with an unencoded space fails with non-JSON output):

```bash
# Stages/jobs/tasks of a run, with per-task status and log ids
az devops invoke --area build --resource timeline \
  --route-parameters project="PROJECT" buildId=12345 --org https://dev.azure.com/ORG --api-version 7.1

# A specific task log
az devops invoke --area build --resource logs \
  --route-parameters project="PROJECT" buildId=12345 logId=24 --org https://dev.azure.com/ORG --api-version 7.1

# A pipeline definition's YAML file path (.process.yamlFilename)
az devops invoke --area build --resource definitions \
  --route-parameters project="PROJECT" definitionId=42 --org https://dev.azure.com/ORG --api-version 7.1
```
