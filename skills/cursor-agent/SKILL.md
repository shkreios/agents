---
name: cursor-agent
description: "Semantic code search and codebase understanding using the cursor-agent CLI. Use this skill when you need to: (1) Understand how specific features or systems work in the codebase, (2) Find relevant files for a task or modification, (3) Answer architecture questions about system design, dependencies, and data flows, (4) Search for code patterns or implementations across the codebase. This tool is particularly valuable for exploring unfamiliar codebases or understanding complex interconnections."
---

# Cursor Agent

Cursor-agent provides semantic code search capabilities that go beyond simple grep/glob searches. It understands code context and can answer high-level questions about architecture, data flows, and system behavior.

## Basic Usage

Execute cursor-agent with the `-p` flag (project mode), `--mode ask` for questions, and `--model composer-1`. Always include "Use codebase_search" at the start of your question:

```bash
cursor-agent -p --mode ask --model composer-1 "Use codebase_search and [your question]"
```

The `-p` flag ensures cursor-agent uses the current project context. The "Use codebase_search" instruction ensures cursor-agent performs a thorough semantic search.

## Effective Questions

Cursor-agent works best with questions that require semantic understanding:

**Good questions:**
- "Use codebase_search and explain how authentication is implemented"
- "Use codebase_search and find all files related to database migrations"
- "Use codebase_search and describe the API request/response flow"
- "Use codebase_search and identify where error handling is implemented"
- "Use codebase_search and show how background jobs are processed"
- "Use codebase_search and explain the testing strategy and framework used"

**Less effective questions:**
- Simple file name searches (use Glob instead)
- Exact string matches (use Grep instead)
- Reading specific known files (use Read instead)

## When to Use vs. Other Tools

- **Use cursor-agent**: For understanding "how" and "why" - architectural questions, finding interconnected components, understanding system behavior
- **Use Grep/Glob**: For finding specific strings, file names, or known patterns
- **Use Read**: When you already know which file to examine

## Output Handling

Cursor-agent output includes:
- Relevant file paths
- Explanations of how systems work
- Code context and relationships

After running cursor-agent, you may need to read specific files it identifies for detailed examination.
