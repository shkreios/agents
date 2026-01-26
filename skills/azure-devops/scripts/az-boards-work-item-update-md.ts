#!/usr/bin/env bun

import { cac } from "cac";
import { execFileSync, execSync } from "child_process";

const cli = cac("az-boards-work-item-update-md");

// Helper to read content from file or use as string
const getContent = (input: string): string => {
  if (!input) return "";

  // Check if it's a file path
  try {
    const fs = require("fs");
    if (fs.existsSync(input)) {
      return fs.readFileSync(input, "utf-8");
    }
  } catch (e) {
    // Not a file, treat as string
  }
  return input;
};

// Helper to get organization URL
const getOrgUrl = (options: {
  org?: string;
  organization?: string;
  detect?: string;
}): string => {
  let orgUrl = options.org || options.organization;
  if (!orgUrl && options.detect === "true") {
    try {
      const configOutput = execSync("az devops configure --list 2>/dev/null", {
        encoding: "utf-8",
      });
      const orgMatch = configOutput.match(/organization\s*=\s*(\S+)/);
      if (orgMatch) {
        orgUrl = orgMatch[1];
      }
    } catch (e) {
      // Ignore detection errors, will fail later if org is required
    }
  }

  if (!orgUrl) {
    console.error(
      "Error: Organization URL is required. Set with --organization parameter."
    );
    console.error("Example: --organization https://dev.azure.com/myorg");
    process.exit(1);
  }

  return orgUrl;
};

// Helper to update work item with markdown fields via REST API
const updateMarkdownFields = async (
  workItemId: string,
  orgUrl: string,
  description?: string,
  acceptanceCriteria?: string,
  apiVersion: string = "7.1"
): Promise<any> => {
  // Build JSON patch operations
  const patchOps: Array<{
    op: string;
    path: string;
    value: string;
  }> = [];

  // Add description if provided
  if (description) {
    const descContent = getContent(description);
    patchOps.push(
      {
        op: "add",
        path: "/fields/System.Description",
        value: descContent,
      },
      {
        op: "add",
        path: "/multilineFieldsFormat/System.Description",
        value: "Markdown",
      }
    );
  }

  // Add acceptance criteria if provided
  if (acceptanceCriteria) {
    const criteriaContent = getContent(acceptanceCriteria);
    patchOps.push(
      {
        op: "add",
        path: "/fields/Microsoft.VSTS.Common.AcceptanceCriteria",
        value: criteriaContent,
      },
      {
        op: "add",
        path: "/multilineFieldsFormat/Microsoft.VSTS.Common.AcceptanceCriteria",
        value: "Markdown",
      }
    );
  }

  if (patchOps.length === 0) {
    return null; // No markdown fields to update
  }

  // Get access token for Azure DevOps
  const token = execSync(
    "az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv",
    { encoding: "utf-8" }
  ).trim();

  // Build API URL
  let apiUrl: string;
  if (orgUrl.includes("/_apis/")) {
    apiUrl = `${orgUrl}/wit/workitems/${workItemId}?api-version=${apiVersion}`;
  } else {
    apiUrl = `${orgUrl}/_apis/wit/workitems/${workItemId}?api-version=${apiVersion}`;
  }

  // Make the PATCH request
  const response = await fetch(apiUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json-patch+json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patchOps),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Error: Failed to update work item ${workItemId} with markdown fields`
    );
    console.error(`Status: ${response.status} ${response.statusText}`);
    console.error(`Details: ${errorText}`);
    process.exit(1);
  }

  return await response.json();
};

// CREATE command
cli
  .command("create", "Create work item with markdown-formatted fields")
  .option("--title <title>", "Work item title (required)")
  .option(
    "--type <type>",
    'Work item type (required, e.g., "User Story", "Task", "Bug")'
  )
  .option("--org, --organization <org>", "Azure DevOps organization URL")
  .option("--project <project>", "Azure DevOps project name (required)")
  .option(
    "--description <description>",
    "Path to markdown file for description or markdown string"
  )
  .option("-d, --description <description>", "Alias for --description")
  .option(
    "--acceptance-criteria <criteria>",
    "Path to markdown file for acceptance criteria or markdown string"
  )
  .option(
    "--assigned-to <email>",
    "Email of the person to assign the work item to"
  )
  .option("--area <area>", "Area path")
  .option("--iteration <iteration>", "Iteration path")
  .option("--detect <detect>", "Automatically detect organization", {
    default: "true",
  })
  .option("--api-version <version>", "API version to use", { default: "7.1" })
  .option("--quiet", "Suppress detailed JSON output, only show ID and URL", {
    default: false,
  })
  .action(async (options) => {
    try {
      // Validate required fields
      if (!options.title) {
        console.error("Error: --title is required");
        process.exit(1);
      }
      if (!options.type) {
        console.error("Error: --type is required");
        process.exit(1);
      }
      if (!options.project) {
        console.error("Error: --project is required");
        process.exit(1);
      }

      const orgUrl = getOrgUrl(options);

      // Build az boards work-item create command
      const createArgs = [
        "boards",
        "work-item",
        "create",
        "--title",
        options.title,
        "--type",
        options.type,
        "--organization",
        orgUrl,
        "--project",
        options.project,
        "--output",
        "json",
      ];

      // Add optional fields (but NOT description - we'll add that via REST API)
      if (options.assignedTo) {
        createArgs.push("--assigned-to", options.assignedTo);
      }
      if (options.area) {
        createArgs.push("--area", options.area);
      }
      if (options.iteration) {
        createArgs.push("--iteration", options.iteration);
      }

      // Execute work item creation
      console.log(`Creating work item: ${options.title}...`);

      // Properly escape arguments by using JSON.stringify for shell safety
      const createOutput = execFileSync("az", createArgs, {
        encoding: "utf-8",
      });

      const createdWorkItem = JSON.parse(createOutput);
      const workItemId = createdWorkItem.id.toString();

      console.log(`✅ Created work item ${workItemId}`);

      // Update with markdown fields if provided
      const hasMarkdownFields =
        options.description || options.d || options.acceptanceCriteria;
      if (hasMarkdownFields) {
        console.log(`Updating work item ${workItemId} with markdown fields...`);
        const result = await updateMarkdownFields(
          workItemId,
          orgUrl,
          options.description || options.d,
          options.acceptanceCriteria,
          options.apiVersion
        );

        if (result) {
          const updatedFields: string[] = [];
          if (options.description || options.d)
            updatedFields.push("Description");
          if (options.acceptanceCriteria)
            updatedFields.push("Acceptance Criteria");
          console.log(
            `✅ Updated markdown fields: ${updatedFields.join(", ")}`
          );
        }
      }

      // Output the work item details
      if (!options.quiet) {
        console.log("\nWork Item Details:");
        console.log(JSON.stringify(createdWorkItem, null, 2));
      }

      // Extract and show the work item URL
      const workItemUrl =
        createdWorkItem._links?.html?.href ||
        `${orgUrl}/${options.project}/_workitems/edit/${workItemId}`;
      console.log(`\n🔗 Work Item URL: ${workItemUrl}`);
      console.log(`📋 Work Item ID: ${workItemId}`);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// UPDATE command (original functionality)
cli
  .command("update [id]", "Update work item with markdown-formatted fields")
  .option("--id <id>", "The ID of the work item to update")
  .option(
    "--description <description>",
    "Path to markdown file for description or markdown string"
  )
  .option("-d, --description <description>", "Alias for --description")
  .option(
    "--acceptance-criteria <criteria>",
    "Path to markdown file for acceptance criteria or markdown string"
  )
  .option("--org, --organization <org>", "Azure DevOps organization URL")
  .option("--detect <detect>", "Automatically detect organization", {
    default: "true",
  })
  .option("--api-version <version>", "API version to use", { default: "7.1" })
  .action(async (id, options) => {
    try {
      // Get work item ID from positional arg or --id flag
      const workItemId = id || options.id;
      if (!workItemId) {
        console.error("Error: Work item ID is required");
        cli.outputHelp();
        process.exit(1);
      }

      if (!options.description && !options.d && !options.acceptanceCriteria) {
        console.error(
          "Error: At least one field (--description or --acceptance-criteria) must be provided"
        );
        process.exit(1);
      }

      const orgUrl = getOrgUrl(options);

      // Update with markdown fields
      const result = await updateMarkdownFields(
        workItemId,
        orgUrl,
        options.description || options.d,
        options.acceptanceCriteria,
        options.apiVersion
      );

      if (!result) {
        console.error("Error: No markdown fields to update");
        process.exit(1);
      }

      // Output success message similar to az CLI
      console.log(JSON.stringify(result, null, 2));
      console.log(
        `\n✅ Successfully updated work item ${workItemId} with markdown formatting`
      );

      // Show which fields were updated
      const updatedFields: string[] = [];
      if (options.description || options.d) updatedFields.push("Description");
      if (options.acceptanceCriteria) updatedFields.push("Acceptance Criteria");
      console.log(`Updated fields: ${updatedFields.join(", ")}`);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

cli.help();
cli.version("1.1.0");

cli.parse();
