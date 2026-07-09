#!/usr/bin/env bun

import { cac } from "cac";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";

const cli = cac("az-boards-work-item-update-md");

const fail = (message: string): never => {
  console.error(`Error: ${message}`);
  process.exit(1);
};

const az = (args: string[]): string =>
  execFileSync("az", args, { encoding: "utf-8" });

// Input is either a path to a markdown file or an inline markdown string
const readContent = (input?: string): string | undefined => {
  if (!input) return undefined;
  return existsSync(input) ? readFileSync(input, "utf-8") : input;
};

const resolveOrgUrl = (options: {
  org?: string;
  organization?: string;
}): string => {
  let orgUrl = options.org || options.organization;
  if (!orgUrl) {
    try {
      const config = az(["devops", "configure", "--list"]);
      orgUrl = config.match(/organization\s*=\s*(\S+)/)?.[1];
    } catch {
      // fall through to the error below
    }
  }
  if (!orgUrl) {
    fail(
      "Organization URL is required and none is set in `az devops configure`. Pass --organization https://dev.azure.com/myorg"
    );
  }
  return orgUrl!.replace(/\/+$/, "");
};

const getAccessToken = (): string => {
  try {
    return az([
      "account",
      "get-access-token",
      "--resource",
      "499b84ac-1321-427f-aa17-267ca6975798", // Azure DevOps resource ID
      "--query",
      "accessToken",
      "-o",
      "tsv",
    ]).trim();
  } catch {
    return fail("Could not acquire an Azure access token. Run `az login` first.");
  }
};

// "RefName=file-or-inline-md" → { ref, input }; repeatable flags arrive as arrays
const parseFieldArgs = (field?: string | string[]): Array<{ ref: string; input: string }> =>
  (field === undefined ? [] : ([] as string[]).concat(field)).map((entry) => {
    const sep = entry.indexOf("=");
    if (sep <= 0) {
      fail(`--field must be <RefName>=<file-or-inline-markdown>, got: ${entry}`);
    }
    return { ref: entry.slice(0, sep).trim(), input: entry.slice(sep + 1) };
  });

// Set multiline fields with Markdown format via REST API
// (the az CLI cannot set multilineFieldsFormat)
const updateMarkdownFields = async (
  workItemId: string,
  orgUrl: string,
  description?: string,
  acceptanceCriteria?: string,
  extraFields: Array<{ ref: string; input: string }> = []
): Promise<string[]> => {
  const patchOps: Array<{ op: string; path: string; value: string }> = [];
  const updatedFields: string[] = [];

  const addField = (field: string, label: string, input?: string) => {
    const value = readContent(input);
    if (!value) return;
    patchOps.push(
      { op: "add", path: `/fields/${field}`, value },
      { op: "add", path: `/multilineFieldsFormat/${field}`, value: "Markdown" }
    );
    updatedFields.push(label);
  };

  addField("System.Description", "Description", description);
  addField(
    "Microsoft.VSTS.Common.AcceptanceCriteria",
    "Acceptance Criteria",
    acceptanceCriteria
  );
  for (const { ref, input } of extraFields) {
    addField(ref, ref, input);
  }

  if (patchOps.length === 0) return updatedFields;

  const response = await fetch(
    `${orgUrl}/_apis/wit/workitems/${workItemId}?api-version=7.1`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json-patch+json",
        Authorization: `Bearer ${getAccessToken()}`,
      },
      body: JSON.stringify(patchOps),
    }
  );

  if (!response.ok) {
    fail(
      `Failed to update work item ${workItemId} (${response.status} ${response.statusText}): ${await response.text()}`
    );
  }

  return updatedFields;
};

cli
  .command("create", "Create work item with markdown-formatted fields")
  .option("--title <title>", "Work item title (required)")
  .option(
    "--type <type>",
    'Work item type (required, e.g. "User Story", "Task", "Bug")'
  )
  .option("--project <project>", "Azure DevOps project name (required)")
  .option(
    "--org, --organization <org>",
    "Organization URL (default: from `az devops configure`)"
  )
  .option(
    "-d, --description <description>",
    "Markdown file path or inline markdown string"
  )
  .option(
    "--acceptance-criteria <criteria>",
    "Markdown file path or inline markdown string"
  )
  .option(
    "--field <field>",
    "Any multiline field as markdown: <RefName>=<file-or-inline-md> (repeatable, e.g. Microsoft.VSTS.TCM.ReproSteps=./repro.md)"
  )
  .option("--assigned-to <email>", "Assignee email")
  .option("--area <area>", "Area path")
  .option("--iteration <iteration>", "Iteration path")
  .action(async (options) => {
    for (const flag of ["title", "type", "project"] as const) {
      if (!options[flag]) fail(`--${flag} is required`);
    }

    const orgUrl = resolveOrgUrl(options);

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
    if (options.assignedTo) createArgs.push("--assigned-to", options.assignedTo);
    if (options.area) createArgs.push("--area", options.area);
    if (options.iteration) createArgs.push("--iteration", options.iteration);

    let createdWorkItem: any;
    try {
      createdWorkItem = JSON.parse(az(createArgs));
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    const workItemId = String(createdWorkItem.id);

    const updatedFields = await updateMarkdownFields(
      workItemId,
      orgUrl,
      options.description,
      options.acceptanceCriteria,
      parseFieldArgs(options.field)
    );

    const workItemUrl =
      createdWorkItem._links?.html?.href ||
      `${orgUrl}/${encodeURIComponent(options.project)}/_workitems/edit/${workItemId}`;
    console.log(`Created work item ${workItemId}`);
    if (updatedFields.length > 0) {
      console.log(`Markdown fields set: ${updatedFields.join(", ")}`);
    }
    console.log(`URL: ${workItemUrl}`);
  });

cli
  .command("update <id>", "Update work item with markdown-formatted fields")
  .option(
    "-d, --description <description>",
    "Markdown file path or inline markdown string"
  )
  .option(
    "--acceptance-criteria <criteria>",
    "Markdown file path or inline markdown string"
  )
  .option(
    "--field <field>",
    "Any multiline field as markdown: <RefName>=<file-or-inline-md> (repeatable, e.g. Microsoft.VSTS.TCM.ReproSteps=./repro.md)"
  )
  .option(
    "--org, --organization <org>",
    "Organization URL (default: from `az devops configure`)"
  )
  .action(async (id, options) => {
    if (!options.description && !options.acceptanceCriteria && !options.field) {
      fail(
        "At least one of --description, --acceptance-criteria or --field is required"
      );
    }

    const orgUrl = resolveOrgUrl(options);
    const updatedFields = await updateMarkdownFields(
      id,
      orgUrl,
      options.description,
      options.acceptanceCriteria,
      parseFieldArgs(options.field)
    );

    console.log(`Updated work item ${id}: ${updatedFields.join(", ")}`);
    console.log(`URL: ${orgUrl}/_workitems/edit/${id}`);
  });

cli.help();
cli.version("2.0.0");

try {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
