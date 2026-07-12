#!/usr/bin/env bun

import { cac } from "cac";
import { execFileSync } from "child_process";

const cli = cac("plan-pr-tags");

// Azure DevOps AAD resource id
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
const API_VERSION = "7.1";
// PR labels are still behind the preview API surface
const LABELS_API_VERSION = "7.1-preview.1";

const STORY_PARENT_REL = "System.LinkTypes.Hierarchy-Reverse";
// Portfolio-level types never contribute tags directly
const PORTFOLIO_TYPES = new Set(["Feature", "Epic"]);

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

// https://dev.azure.com/ORG/PROJECT/_git/REPO (project/repo may contain %20)
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
const adoGet = async (url: string): Promise<any> => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) {
    const hint = body.trimStart().startsWith("<")
      ? "Azure DevOps returned a sign-in page instead of JSON: the token was rejected. Run `az login` and retry."
      : body;
    fail(`GET ${url} failed (${response.status} ${response.statusText}): ${hint}`);
  }
  return JSON.parse(body);
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const splitTags = (tags?: string): string[] =>
  (tags ?? "")
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);

// ADO tags/labels are case-insensitive; dedupe accordingly, keep first casing
const dedupe = (tags: string[]): string[] => {
  const seen = new Set<string>();
  return tags.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

interface WorkItem {
  id: number;
  type: string;
  title: string;
  tags: string[];
  parentId?: number;
}

const toWorkItem = (raw: any): WorkItem => ({
  id: raw.id,
  type: raw.fields["System.WorkItemType"],
  title: raw.fields["System.Title"],
  tags: splitTags(raw.fields["System.Tags"]),
  parentId: (raw.relations ?? [])
    .filter((r: any) => r.rel === STORY_PARENT_REL)
    .map((r: any) => Number(r.url.split("/").pop()))[0],
});

const fetchWorkItems = async (
  orgUrl: string,
  ids: number[]
): Promise<Map<number, WorkItem>> => {
  const items = new Map<number, WorkItem>();
  for (const batch of chunk(ids, 200)) {
    const data = await adoGet(
      `${orgUrl}/_apis/wit/workitems?ids=${batch.join(",")}&$expand=relations&api-version=${API_VERSION}`
    );
    for (const raw of data.value) items.set(raw.id, toWorkItem(raw));
  }
  return items;
};

cli
  .command("", "Compute a PR label plan from linked work item tags")
  .option("--status <status>", "PR status filter", { default: "active" })
  .option("--repository <repo>", "Repository name (default: from git remote)")
  .option("--project <project>", "Project name (default: from git remote or `az devops configure`)")
  .option("--org, --organization <org>", "Organization URL (default: from git remote or `az devops configure`)")
  .option("--pr <id>", "Only plan for specific PR id(s), repeatable")
  .action(async (options) => {
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

    // Page through PRs
    const prs: any[] = [];
    const pageSize = 200;
    for (let skip = 0; ; skip += pageSize) {
      const page = await adoGet(
        `${base}/pullrequests?searchCriteria.status=${options.status}&$top=${pageSize}&$skip=${skip}&api-version=${API_VERSION}`
      );
      prs.push(...page.value);
      if (page.value.length < pageSize) break;
    }
    const onlyIds = [options.pr ?? []].flat().map(Number);
    const selected = onlyIds.length
      ? prs.filter((pr) => onlyIds.includes(pr.pullRequestId))
      : prs;

    // Linked work item refs and current labels, a few PRs at a time
    const linked = new Map<number, number[]>();
    const labels = new Map<number, string[]>();
    for (const batch of chunk(selected, 8)) {
      await Promise.all(
        batch.map(async (pr) => {
          const [refs, lbls] = await Promise.all([
            adoGet(`${base}/pullRequests/${pr.pullRequestId}/workitems?api-version=${API_VERSION}`),
            adoGet(`${base}/pullRequests/${pr.pullRequestId}/labels?api-version=${LABELS_API_VERSION}`),
          ]);
          linked.set(pr.pullRequestId, refs.value.map((r: any) => Number(r.id)));
          labels.set(
            pr.pullRequestId,
            lbls.value.filter((l: any) => l.active !== false).map((l: any) => l.name)
          );
        })
      );
    }

    // Fetch linked items, then any Task parents not already fetched
    const allIds = [...new Set([...linked.values()].flat())];
    const items = allIds.length ? await fetchWorkItems(orgUrl, allIds) : new Map<number, WorkItem>();
    const parentIds = [...items.values()]
      .filter((wi) => wi.type === "Task" && wi.parentId && !items.has(wi.parentId))
      .map((wi) => wi.parentId!);
    if (parentIds.length) {
      for (const [id, wi] of await fetchWorkItems(orgUrl, [...new Set(parentIds)])) {
        items.set(id, wi);
      }
    }

    const plan = selected.map((pr) => {
      const prId = pr.pullRequestId;
      const sources = new Map<number, WorkItem>();
      const taskSources = new Map<number, WorkItem>();
      const unresolved: string[] = [];
      for (const id of linked.get(prId) ?? []) {
        const wi = items.get(id);
        if (!wi) {
          unresolved.push(`work item #${id} could not be fetched`);
        } else if (wi.type === "Task") {
          const parent = wi.parentId ? items.get(wi.parentId) : undefined;
          if (parent) {
            sources.set(parent.id, parent);
            taskSources.set(wi.id, wi);
          } else unresolved.push(`Task #${id} has no parent`);
        } else if (PORTFOLIO_TYPES.has(wi.type)) {
          unresolved.push(`${wi.type} #${id} ignored`);
        } else {
          sources.set(wi.id, wi);
        }
      }

      const currentLabels = labels.get(prId) ?? [];
      const common = {
        prId,
        title: pr.title,
        createdBy: pr.createdBy?.displayName,
        currentLabels,
        stories: [...sources.values()].map(({ id, type, title, tags }) => ({ id, type, title, tags })),
        tasks: [...taskSources.values()].map(({ id, title, tags }) => ({ id, title, tags })),
        notes: unresolved,
      };
      if (sources.size === 0) {
        const reason = unresolved.length ? unresolved.join("; ") : "no work items linked";
        return { ...common, status: "skipped", reason };
      }

      const finalTags = dedupe(
        [...sources.values(), ...taskSources.values()].flatMap((s) => s.tags)
      );
      const currentLower = new Set(currentLabels.map((l) => l.toLowerCase()));
      const finalLower = new Set(finalTags.map((t) => t.toLowerCase()));
      const add = finalTags.filter((t) => !currentLower.has(t.toLowerCase()));
      const remove = currentLabels.filter((l) => !finalLower.has(l.toLowerCase()));
      return {
        ...common,
        status: add.length || remove.length ? "changed" : "unchanged",
        finalTags,
        add,
        remove,
      };
    });

    const applyMap = Object.fromEntries(
      plan
        .filter((p) => p.status === "changed")
        .map((p: any) => [p.prId, p.finalTags])
    );

    console.log(
      JSON.stringify({ organization: orgUrl, project, repository, plan, applyMap }, null, 2)
    );
  });

cli.help();
cli.version("1.0.0");

try {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
