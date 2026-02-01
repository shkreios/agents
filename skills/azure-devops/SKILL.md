---
name: azure-devops
description: Work with Azure DevOps using az CLI commands and REST API. Use for: (1) Managing work items (create, update, query), (2) Pull request operations, (3) Pipeline management, (4) Repository operations, (5) Project and organization tasks. Includes support for markdown-formatted work item fields not available in standard az CLI.
---

## Requirements

- Azure CLI with azure-devops extension installed
- Bun runtime (for custom markdown script)
- Authenticated Azure session (`az login`)

### Installation

```bash
# Install Azure CLI (macOS)
brew install azure-cli

# Install Azure DevOps extension
az extension add --name azure-devops

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Authenticate with Azure
az login
```

# Azure DevOps

Work with Azure DevOps using `az` CLI commands and REST API for operations not supported by the CLI.

## Work Items

### Create

```bash
# Standard create (without markdown)
az boards work-item create \
  --title "Task title" \
  --type "User Story" \
  --description "Description text" \
  --assigned-to "user@domain.com" \
  --area "Team/Area" \
  --iteration "Sprint 1"
```

### Create with Markdown Fields

**Use custom script** for markdown-formatted Description and Acceptance Criteria:

```bash
# Create with markdown files
./scripts/az-boards-work-item-update-md.ts create \
  --title "Implement feature X" \
  --type "User Story" \
  --project "MyProject" \
  --organization https://dev.azure.com/myorg \
  --description ./description.md \
  --acceptance-criteria ./acceptance.md

# Create with inline markdown
./scripts/az-boards-work-item-update-md.ts create \
  --title "Fix bug in login flow" \
  --type "Bug" \
  --project "MyProject" \
  --description "# Bug Description\n\nMarkdown content here" \
  --assigned-to "user@domain.com"

# Create with optional fields
./scripts/az-boards-work-item-update-md.ts create \
  --title "Add tests" \
  --type "Task" \
  --project "MyProject" \
  --organization https://dev.azure.com/myorg \
  --area "Team/ComponentA" \
  --iteration "Sprint 5" \
  --assigned-to "dev@company.com" \
  --description ./test-plan.md

# Auto-detect organization from az config
./scripts/az-boards-work-item-update-md.ts create \
  --title "New feature" \
  --type "User Story" \
  --project "MyProject" \
  -d ./description.md

# Create with quiet mode (minimal output)
./scripts/az-boards-work-item-update-md.ts create \
  --title "New feature" \
  --type "User Story" \
  --project "MyProject" \
  --quiet \
  -d ./description.md
```

**Required Parameters:**
- `--title` - Work item title
- `--type` - Work item type (e.g., "User Story", "Task", "Bug", "Feature")
- `--project` - Azure DevOps project name

**Optional Parameters:**
- `--description` or `-d` - Markdown file path or inline markdown string
- `--acceptance-criteria` - Markdown file path or inline markdown string
- `--assigned-to` - Email of assignee
- `--area` - Area path
- `--iteration` - Iteration path
- `--organization` - Azure DevOps organization URL (auto-detected if not provided)
- `--quiet` - Suppress detailed JSON output, only show ID and URL

**Output:**
- Work item ID
- Work item URL
- Full work item JSON

### Update

```bash
# Standard update
az boards work-item update \
  --id 12345 \
  --title "New title" \
  --state "Active" \
  --assigned-to "user@domain.com"

# Custom fields
az boards work-item update \
  --id 12345 \
  --fields "System.Tags=tag1; tag2" "Priority=1"
```

### Update with Markdown Fields

**Use custom script** for markdown-formatted Description and Acceptance Criteria:

```bash
# Update with markdown files
./scripts/az-boards-work-item-update-md.ts update 12345 \
  --description ./description.md \
  --acceptance-criteria ./acceptance.md

# Update with inline markdown
./scripts/az-boards-work-item-update-md.ts update 12345 \
  --description "# Title\n\nMarkdown content"

# Auto-detect organization from az config
./scripts/az-boards-work-item-update-md.ts update 12345 -d ./desc.md

# Specify organization explicitly
./scripts/az-boards-work-item-update-md.ts update 12345 \
  --organization https://dev.azure.com/myorg \
  --description ./desc.md
```

**Note**: Once a field is set to Markdown format, it cannot be reverted to HTML.

### Query

```bash
# List work items
az boards work-item show --id 12345

# Query with WIQL
az boards query --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active'"

# Filter output
az boards work-item show --id 12345 --query "fields.['System.Title', 'System.State']"
```

### Relations

```bash
# Link work items
az boards work-item relation add \
  --id 12345 \
  --relation-type "Parent" \
  --target-id 67890

# Common relation types: Parent, Child, Related, Duplicate, Predecessor, Successor
```

## Pull Requests

### CRITICAL: Before Creating a PR

**DO NOT** use `az devops configure` or `az devops project list` to discover project info.
**ALWAYS** extract organization, project, and repository from the git remote URL first.

The git remote URL contains ALL required information:
```
https://dev.azure.com/ORG/PROJECT/_git/REPO
```

### Creating a Pull Request (Step-by-Step)

Follow these steps IN ORDER to avoid failures:

**Step 1: Extract org/project/repo from git remote (DO THIS FIRST)**

```bash
# Get the remote URL - parse ORG, PROJECT, REPO from it
git remote get-url origin
# Example output: https://dev.azure.com/myorg/My%20Project/_git/My.Repo
# ORG = myorg
# PROJECT = My Project (URL decode %20 to space)
# REPO = My.Repo
```

**Step 2: Check if source branch is pushed to remote**

```bash
# Verify branch exists on remote
git ls-remote --heads origin | grep <branch-name>

# If NOT found, push first:
git push -u origin <branch-name>
```

**Step 3: Prepare description (MUST be under 4000 characters)**

```bash
# Check description length - Azure DevOps limit is 4000 characters
wc -c description.md
# If over 4000, shorten the description before proceeding
```

**Step 4: Create PR with ALL required flags**

```bash
az repos pr create \
  --source-branch feature/my-branch \
  --target-branch develop \
  --title "PR Title" \
  --description "$(cat description.md)" \
  --organization https://dev.azure.com/ORG \
  --project "PROJECT" \
  --repository "REPO"
```

**Required flags for `az repos pr create`:**
- `--source-branch` - Your feature branch
- `--target-branch` - Target branch (e.g., develop, main)
- `--title` - PR title
- `--organization` - Full URL: `https://dev.azure.com/ORG`
- `--project` - Project name (with spaces, not URL encoded)
- `--repository` - Repository name (REQUIRED - not optional despite docs)

### PR Management

```bash
# List PRs
az repos pr list --status active \
  --organization https://dev.azure.com/ORG \
  --project "PROJECT"

# Show PR details
az repos pr show --id 123 \
  --organization https://dev.azure.com/ORG

# Add reviewer
az repos pr reviewer add --id 123 --reviewers user@domain.com \
  --organization https://dev.azure.com/ORG

# Vote on PR
az repos pr set-vote --id 123 --vote approve \
  --organization https://dev.azure.com/ORG

# Complete PR
az repos pr update --id 123 --status completed \
  --organization https://dev.azure.com/ORG
```

## Pipelines

```bash
# List pipelines
az pipelines list

# Run pipeline
az pipelines run --name "Pipeline Name"

# Run with variables
az pipelines run --id 42 --variables key1=value1 key2=value2

# Show pipeline run
az pipelines runs show --id 123

# List runs
az pipelines runs list --pipeline-ids 42 --status completed
```

## Repositories

```bash
# List repos
az repos list

# Show repo
az repos show --repository MyRepo

# Create repo
az repos create --name NewRepo

# Set default branch
az repos update --repository MyRepo --default-branch main
```

## Projects & Teams

```bash
# List projects
az devops project list

# Create project
az devops project create --name "New Project"

# List teams
az devops team list --project MyProject

# Create team
az devops team create --name "New Team"
```

## Output Formats

```bash
# JSON (default)
az boards work-item show --id 12345

# Table
az boards work-item show --id 12345 --output table

# TSV (for scripting)
az boards work-item show --id 12345 --output tsv

# JMESPath query
az boards work-item show --id 12345 --query "fields.['System.Title']" -o tsv
```

## Common Patterns

### Bulk Update Work Items

```bash
# Get work item IDs from query
IDS=$(az boards query --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'New'" --query "[].id" -o tsv)

# Update each work item
for id in $IDS; do
  az boards work-item update --id $id --state "Active"
done
```

### Create PR with Work Items

```bash
# First: Extract org/project/repo from git remote
# git remote get-url origin → https://dev.azure.com/ORG/PROJECT/_git/REPO

# Second: Verify branch is pushed
# git ls-remote --heads origin | grep feature/my-branch

# Create PR and link work items (all flags required)
PR_ID=$(az repos pr create \
  --source-branch feature/my-branch \
  --target-branch main \
  --title "My PR" \
  --description "PR description (max 4000 chars)" \
  --work-items 12345 67890 \
  --organization https://dev.azure.com/ORG \
  --project "PROJECT" \
  --repository "REPO" \
  --query "pullRequestId" -o tsv)

echo "Created PR: $PR_ID"
```

### Pipeline Status Check

```bash
# Run pipeline and wait for completion
RUN_ID=$(az pipelines run --id 42 --query "id" -o tsv)

while true; do
  STATUS=$(az pipelines runs show --id $RUN_ID --query "status" -o tsv)
  if [[ "$STATUS" == "completed" ]]; then
    RESULT=$(az pipelines runs show --id $RUN_ID --query "result" -o tsv)
    echo "Pipeline finished: $RESULT"
    break
  fi
  sleep 10
done
```

## Best Practices

### General
1. **Always pass `--organization` and `--project`** explicitly - NEVER use `az devops configure` to set defaults
2. **Use environment variables** for PAT (`AZURE_DEVOPS_EXT_PAT`)
3. **Filter output** with `--query` to extract specific fields
4. **Use TSV output** (`-o tsv`) for scripting to avoid parsing JSON
5. **Check existence** before creation to ensure idempotency
6. **Use latest API version** (7.1) for REST API calls
7. **Implement retry logic** for transient failures (rate limits, timeouts)

### Pull Requests
8. **Parse git remote first** - Extract org/project/repo from `git remote get-url origin` before any az commands
9. **NEVER use `az devops project list` for discovery** - All info is in the git remote URL
10. **Always include `--repository`** - This flag is required despite documentation suggesting otherwise
11. **PR description limit is 4000 characters** - Check length before creating PR
12. **Verify branch is pushed** - Source branch must exist on remote before PR creation

## Troubleshooting

```bash
# Check extension version
az version --query "extensions.\"azure-devops\""

# Update extension
az extension update --name azure-devops

# Clear cached credentials
az devops logout

# Verify authentication
az devops project list

# Enable debug output
az boards work-item show --id 12345 --debug
```
