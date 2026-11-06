---
name: po-board
description: >-
  Product Owner (PO) Backlog, Token Estimation, Model Tiering, and GitHub Project #2 Kanban Board workflow.
  Activate this skill whenever grooming the backlog, estimating tickets, prioritizing issues, delegating tasks to worker subagents (flash_lite, flash, pro), or updating ticket statuses on the GitHub Kanban board.
---

# Product Owner (PO) & GitHub Kanban Board Workflow

This skill guides the Product Owner (PO) agent (running on **Gemini 4 Argon**) to manage `michikarg-ai/surfsk8_game` issues and the [GitHub Project #2 Kanban Board](https://github.com/users/michikarg-ai/projects/2/views/1).

## 1. Inspecting Backlog & Creating Issues

Run the board helper script to view all open/closed issues and their current Kanban board column, or create a new issue directly on the board:

```bash
# List all issues & board statuses:
node .agents/skills/po-board/scripts/gh_board.mjs list

# Create a new issue and place it in a column (e.g. "Backlog", "In Progress", "In Review"):
node .agents/skills/po-board/scripts/gh_board.mjs create "<Title>" "<Description>" "In Progress"
```

## 2. Token Estimation & Cost/Quality Model Selection

For every backlog item, the PO estimates token consumption and selects the most cost-effective model tier:

1. **`flash_lite` (~5k–15k Tokens):**
   - Single-file changes, simple state/config updates, randomizers, copy changes.
2. **`flash` (~15k–50k Tokens):**
   - Standard UI/HUD components, CSS layouts, responsive tweaks, Puppeteer screenshot tests, implementing an approved UX concept.
3. **`pro` / `inherit` (~50k–160k Tokens):**
   - Complex 3D Three.js math, skeletal/ragdoll bone animations, physics tuning (`SurfskateController.ts`), new game modes, architectural concepts, and final PO acceptance review.

Record the PO estimation on the GitHub issue:

```bash
node .agents/skills/po-board/scripts/gh_board.mjs estimate <issue_number> "~12k Tokens" "flash_lite" "P1 (Quick-Win)" "Randomize initial track index in SurfAudio.ts"
```

## 3. Keeping Kanban Status Synchronized

Always keep the ticket status on GitHub Project #2 up to date at every transition:

```bash
# Move to Ready after estimation/grooming:
node .agents/skills/po-board/scripts/gh_board.mjs status <issue_number> "Ready"

# Move to In Progress right before invoking the worker subagent:
node .agents/skills/po-board/scripts/gh_board.mjs status <issue_number> "In Progress"

# Move to In Review when waiting for user concept approval ("Go") or QA check:
node .agents/skills/po-board/scripts/gh_board.mjs status <issue_number> "In Review"

# Move to Done after build verification, commit, and push to origin/main:
node .agents/skills/po-board/scripts/gh_board.mjs status <issue_number> "Done"
```

## 4. Delegating to Worker Subagents

1. Define the `dev-worker` subagent (if not already defined in the current conversation) using `define_subagent` with `EnableWriteTools: true`.
2. Launch the subagent via `invoke_subagent` with the exact `Model` chosen in Step 2 (`flash_lite`, `flash`, `pro`, or `inherit`):
   - Provide clear file paths, acceptance criteria, and instructions to run `npm run build` before finishing.
   - Instruct the worker **not** to `git push` directly so the PO can perform final acceptance review first.
3. Once the worker completes, the PO reviews `git diff` and build/test output, commits with `Fixes #<issue_number>` (or `Refs #<issue_number>`), pushes to `origin/main`, and updates the Kanban board status to `Done`.
