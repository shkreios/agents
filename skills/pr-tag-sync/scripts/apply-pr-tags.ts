#!/usr/bin/env bun

import { cac } from "cac";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";

const cli = cac("apply-pr-tags");

// Azure DevOps AAD resource id
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
// PR labels are still behind the preview API surface
const LABELS_API_VERSION = "7.1-preview.1";

const fail = (message: string): never => {
  console.error(`Error: ${message}`);
  process.exit(1);
};

const az = (args: string[]): string =>
  execFileSync("az", args, { encoding: "utf-8" });

const azConfig = (): string => {
  try {
    return az(["devops", "configure", "--list"]);
  } catch {
    return "";
  }
};

const gitRemoteUrl = (): string => {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
};

const parseRemote = (
  url: string
): { org: string; project: string; repo: string } | undefined => {
  const match = url.match(
    /https:\/\/(?:\w+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/
  );
  if (!match) return undefined;
  return {
    org: `https://dev.azure.com/${match[1]}`,
    project: decodeURIComponent(match[2]),
    repo: decodeURIComponent(match[3]),
  };
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

let token: string;
const ado = async (method: string, url: string, body?: unknown): Promise<any> => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const isJson = response.headers.get("content-type")?.includes("json");
  if (!response.ok || (response.status !== 204 && !isJson && text.length > 0)) {
    const hint = text.trimStart().startsWith("<")
      ? "Azure DevOps returned a sign-in page instead of JSON: the token was rejected. Run `az login` and retry."
      : text;
    throw new Error(`${method} ${url} failed (${response.status} ${response.statusText}): ${hint}`);
  }
  return text.length && isJson ? JSON.parse(text) : undefined;
};

cli
  .command(
    "[map]",
    'JSON map of PR id to exact final label list, as a file path, inline JSON, or stdin when omitted. Example: {"123": ["tag1", "tag2"]}'
  )
  .option("--repository <repo>", "Repository name (default: from git remote)")
  .option("--project <project>", "Project name (default: from git remote or `az devops configure`)")
  .option("--org, --organization <org>", "Organization URL (default: from git remote or `az devops configure`)")
  .action(async (mapInput, options) => {
    const raw =
      !mapInput || mapInput === "-"
        ? readFileSync(0, "utf-8")
        : existsSync(mapInput)
          ? readFileSync(mapInput, "utf-8")
          : mapInput;
    let map: Record<string, string[]>;
    try {
      map = JSON.parse(raw);
    } catch {
      return fail("Input is not valid JSON (expected {\"<prId>\": [\"tag\", ...]})");
    }
    const entries = Object.entries(map);
    if (!entries.length) return fail("Map is empty, nothing to apply");
    for (const [prId, tags] of entries) {
      if (!/^\d+$/.test(prId) || !Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
        return fail(`Invalid entry for "${prId}": keys must be PR ids, values arrays of tag strings`);
      }
    }

    const remote = parseRemote(gitRemoteUrl());
    const config = azConfig();
    const orgUrl = (
      options.org ||
      options.organization ||
      remote?.org ||
      config.match(/organization\s*=\s*(\S+)/)?.[1] ||
      fail("No organization: pass --organization or run from an Azure DevOps git repo")
    ).replace(/\/+$/, "");
    const project =
      options.project ||
      remote?.project ||
      config.match(/project\s*=\s*(.+)/)?.[1]?.trim() ||
      fail("No project: pass --project or run from an Azure DevOps git repo");
    const repository =
      options.repository ||
      remote?.repo ||
      fail("No repository: pass --repository or run from an Azure DevOps git repo");

    token = getAccessToken();
    const base = `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository)}`;

    const results: any[] = [];
    let failed = 0;
    for (const [prId, finalTags] of entries) {
      try {
        const labelsUrl = `${base}/pullRequests/${prId}/labels`;
        const current = await ado("GET", `${labelsUrl}?api-version=${LABELS_API_VERSION}`);
        const currentNames: string[] = current.value
          .filter((l: any) => l.active !== false)
          .map((l: any) => l.name);
        const finalLower = new Set(finalTags.map((t) => t.toLowerCase()));
        const currentLower = new Set(currentNames.map((l) => l.toLowerCase()));
        const add = finalTags.filter((t) => !currentLower.has(t.toLowerCase()));
        const remove = currentNames.filter((l) => !finalLower.has(l.toLowerCase()));

        for (const name of add) {
          await ado("POST", `${labelsUrl}?api-version=${LABELS_API_VERSION}`, { name });
        }
        for (const name of remove) {
          await ado(
            "DELETE",
            `${labelsUrl}/${encodeURIComponent(name)}?api-version=${LABELS_API_VERSION}`
          );
        }
        results.push({ prId: Number(prId), added: add, removed: remove, status: "ok" });
      } catch (error) {
        failed++;
        results.push({
          prId: Number(prId),
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(JSON.stringify({ organization: orgUrl, project, repository, results }, null, 2));
    if (failed) fail(`${failed} of ${entries.length} PR(s) failed, see results above`);
  });

cli.help();
cli.version("1.0.0");

try {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
