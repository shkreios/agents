#!/usr/bin/env bun

import { cac } from "cac";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";

const cli = cac("az-boards-comment-md");

// Azure DevOps AAD resource id
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
// Comments live behind the preview API surface; 7.1-preview.4 supports `format`
const API_VERSION = "7.1-preview.4";

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

const azConfig = (): string => {
  try {
    return az(["devops", "configure", "--list"]);
  } catch {
    return "";
  }
};

const resolveOrgUrl = (options: {
  org?: string;
  organization?: string;
}): string => {
  const orgUrl =
    options.org ||
    options.organization ||
    azConfig().match(/organization\s*=\s*(\S+)/)?.[1];
  if (!orgUrl) {
    fail(
      "Organization URL is required and none is set in `az devops configure`. Pass --organization https://dev.azure.com/myorg"
    );
  }
  return orgUrl!.replace(/\/+$/, "");
};

const resolveProject = (options: { project?: string }): string => {
  const project =
    options.project || azConfig().match(/project\s*=\s*(.+)/)?.[1]?.trim();
  if (!project) {
    fail(
      'Project is required for the comments API and none is set in `az devops configure`. Pass --project "My Project"'
    );
  }
  return project!;
};

const getAccessToken = (): string => {
  try {
    return az([
      "account",
      "get-access-token",
      "--resource",
      ADO_RESOURCE,
      "--query",
      "accessToken",
      "-o",
      "tsv",
    ]).trim();
  } catch {
    return fail("Could not acquire an Azure access token. Run `az login` first.");
  }
};

const saveComment = async (
  method: "POST" | "PATCH",
  workItemId: string,
  commentId: string | undefined,
  options: { text?: string; project?: string; org?: string; organization?: string }
) => {
  const text = readContent(options.text);
  if (!text) fail("--text (markdown file path or inline markdown) is required");

  const orgUrl = resolveOrgUrl(options);
  const project = encodeURIComponent(resolveProject(options));
  const commentPath = commentId ? `/${commentId}` : "";
  const url = `${orgUrl}/${project}/_apis/wit/workItems/${workItemId}/comments${commentPath}?format=markdown&api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    fail(
      `Comment request failed (${response.status} ${response.statusText}): ${await response.text()}`
    );
  }

  const result: any = await response.json();
  const version = result.version ? ` v${result.version}` : "";
  console.log(
    `Comment ${result.id}${version} on work item ${workItemId} saved as ${result.format || "markdown"}`
  );
};

cli
  .command("add <workItemId>", "Add a markdown comment to a work item")
  .option("-t, --text <text>", "Markdown file path or inline markdown string")
  .option(
    "--project <project>",
    "Project name (default: from `az devops configure`)"
  )
  .option(
    "--org, --organization <org>",
    "Organization URL (default: from `az devops configure`)"
  )
  .action((workItemId, options) => saveComment("POST", workItemId, undefined, options));

cli
  .command(
    "update <workItemId> <commentId>",
    "Update an existing comment with markdown"
  )
  .option("-t, --text <text>", "Markdown file path or inline markdown string")
  .option(
    "--project <project>",
    "Project name (default: from `az devops configure`)"
  )
  .option(
    "--org, --organization <org>",
    "Organization URL (default: from `az devops configure`)"
  )
  .action((workItemId, commentId, options) =>
    saveComment("PATCH", workItemId, commentId, options)
  );

cli.help();
cli.version("2.0.0");

try {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
