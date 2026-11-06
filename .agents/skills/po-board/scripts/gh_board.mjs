#!/usr/bin/env node
/**
 * GitHub Project #2 & Issue Management CLI for the Product Owner (PO) Agent
 * Repository: michikarg-ai/surfsk8_game
 * Project:    https://github.com/users/michikarg-ai/projects/2
 */

import { execFileSync } from 'child_process';

const OWNER = 'michikarg-ai';
const REPO = 'surfsk8_game';
const PROJECT_NUMBER = 2;
const PO_HEADER = '### 🧠 Product Owner (Gemini 4 Argon) — Estimation & Routing';

function runGhArgs(args, input = undefined) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    return null;
  }
}

function isGhAuthenticated() {
  const res = runGhArgs(['auth', 'status']);
  return res !== null;
}

async function fetchPublicIssues() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/issues?state=all&per_page=50`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SRFSK8-PO-Agent' },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

function getIssueComments(issueNumber) {
  const out = runGhArgs([
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    `${OWNER}/${REPO}`,
    '--json',
    'comments',
  ]);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    return parsed?.comments || [];
  } catch {
    return [];
  }
}

function validatePoEstimationComment(body) {
  if (!body || !body.includes(PO_HEADER)) {
    return { valid: false, missing: ['PO Estimation Comment'] };
  }
  const requiredFields = [
    { label: 'Priority', regex: /-\s*\*\*Priority:\*\*\s*(.+)/ },
    { label: 'Estimated Effort', regex: /-\s*\*\*Estimated Effort:\*\*\s*`?([^`\n]+)`?/ },
    { label: 'Assigned Worker Model', regex: /-\s*\*\*Assigned Worker Model:\*\*\s*`?([^`\n]+)`?/ },
    { label: 'PO Notes / Plan', regex: /-\s*\*\*PO Notes \/ Plan:\*\*\s*(.+)/ },
  ];
  const missing = [];
  for (const field of requiredFields) {
    const match = body.match(field.regex);
    const val = match?.[1]?.trim() || '';
    if (!val) {
      missing.push(field.label);
    }
  }
  return { valid: missing.length === 0, missing };
}

function checkDefinitionOfReady(issueNumber) {
  const comments = getIssueComments(issueNumber);
  const poComments = comments.filter((c) => c.body && c.body.includes(PO_HEADER));
  if (poComments.length === 0) {
    return { valid: false, missing: ['PO Estimation Comment (run `estimate` first)'] };
  }
  const latest = poComments[poComments.length - 1];
  return validatePoEstimationComment(latest.body);
}

function getProjectMetadata() {
  const query = `
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          id
          title
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
          items(first: 100) {
            nodes {
              id
              fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  optionId
                }
              }
              content {
                ... on Issue {
                  number
                  title
                  state
                  url
                }
              }
            }
          }
        }
      }
    }
  `;
  const out = runGhArgs([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `owner=${OWNER}`,
    '-F',
    `number=${PROJECT_NUMBER}`,
  ]);
  if (!out) return null;
  try {
    const parsed = JSON.parse(out);
    return parsed?.data?.user?.projectV2 || null;
  } catch {
    return null;
  }
}

async function cmdList() {
  const ghAuthed = isGhAuthenticated();
  const project = ghAuthed ? getProjectMetadata() : null;
  const issues = await fetchPublicIssues();

  const statusByIssueNumber = new Map();
  if (project?.items?.nodes) {
    for (const item of project.items.nodes) {
      if (item.content?.number) {
        statusByIssueNumber.set(item.content.number, item.fieldValueByName?.name || 'No Status');
      }
    }
  }

  console.log(`=== SRFSK8 Backlog & Board Status (gh auth: ${ghAuthed ? 'YES' : 'NO - Read-Only Public API'}) ===`);
  if (project) {
    const statusField = project.fields.nodes.find((f) => f.name === 'Status');
    if (statusField) {
      console.log(`Available Board Columns: ${statusField.options.map((o) => o.name).join(' | ')}\n`);
    }
  } else if (!ghAuthed) {
    console.log(`Hint: Run 'gh auth login -s repo,project' to enable live Kanban column reads/writes.\n`);
  }

  for (const issue of issues) {
    if (issue.pull_request) continue;
    const boardStatus = statusByIssueNumber.get(issue.number) || (issue.state === 'closed' ? 'Done' : 'Backlog');
    console.log(`#${issue.number} [${boardStatus}] (${issue.state.toUpperCase()}) — ${issue.title}`);
    if (issue.body) {
      console.log(`   Description: ${issue.body.replace(/\r?\n/g, ' ').slice(0, 180)}${issue.body.length > 180 ? '...' : ''}`);
    }
  }
}

async function cmdSetStatus(issueNumber, targetStatusName) {
  if (!isGhAuthenticated()) {
    console.error(`⚠️ Cannot update Project #2 column to "${targetStatusName}" because 'gh' CLI is not logged in.`);
    console.error(`   Run: gh auth login -s repo,project`);
    process.exit(1);
  }

  // Enforce Definition of Ready (DoR) before moving to Ready or In progress
  const normalizedTarget = targetStatusName.trim().toLowerCase();
  if (normalizedTarget === 'ready' || normalizedTarget === 'in progress') {
    const dor = checkDefinitionOfReady(issueNumber);
    if (!dor.valid) {
      console.error(
        `❌ Definition of Ready (DoR) failed for Issue #${issueNumber}! Cannot move to "${targetStatusName}".`
      );
      console.error(`   Missing / empty PO fields: ${dor.missing.join(', ')}`);
      console.error(
        `   Fix with: node .agents/skills/po-board/scripts/gh_board.mjs estimate ${issueNumber} "<tokens>" "<model>" "<prio>" "<notes>"`
      );
      process.exit(1);
    }
  }

  const project = getProjectMetadata();
  if (!project) {
    console.error(`⚠️ Could not load Project #${PROJECT_NUMBER} for user ${OWNER}. Ensure 'project' scope is granted: gh auth refresh -s project`);
    process.exit(1);
  }

  const statusField = project.fields.nodes.find((f) => f.name === 'Status');
  if (!statusField) {
    console.error(`⚠️ Could not find 'Status' field on Project #${PROJECT_NUMBER}.`);
    process.exit(1);
  }

  const option = statusField.options.find(
    (o) => o.name.toLowerCase() === normalizedTarget
  );
  if (!option) {
    console.error(
      `⚠️ Column "${targetStatusName}" not found. Available columns: ${statusField.options.map((o) => o.name).join(', ')}`
    );
    process.exit(1);
  }

  let item = project.items.nodes.find((n) => n.content?.number === Number(issueNumber));
  if (!item) {
    const issueUrl = `https://github.com/${OWNER}/${REPO}/issues/${issueNumber}`;
    runGhArgs(['project', 'item-add', String(PROJECT_NUMBER), '--owner', OWNER, '--url', issueUrl]);
    const refreshed = getProjectMetadata();
    item = refreshed?.items?.nodes?.find((n) => n.content?.number === Number(issueNumber));
  }

  if (!item) {
    console.error(`⚠️ Issue #${issueNumber} could not be found or added to Project #${PROJECT_NUMBER}.`);
    process.exit(1);
  }

  const res = runGhArgs([
    'project',
    'item-edit',
    '--id',
    item.id,
    '--project-id',
    project.id,
    '--field-id',
    statusField.id,
    '--single-select-option-id',
    option.id,
  ]);
  if (res === null) {
    console.error(`⚠️ Failed to move Issue #${issueNumber} to "${option.name}".`);
    process.exit(1);
  }
  console.log(`✅ Moved Issue #${issueNumber} (${item.content.title}) -> [${option.name}]`);
}

async function cmdEstimate(issueNumber, tokens, model, prio, notes) {
  if (!isGhAuthenticated()) {
    console.error(`⚠️ Cannot post PO estimation comment to Issue #${issueNumber}: 'gh' CLI not authenticated.`);
    process.exit(1);
  }

  const cleanTokens = (tokens || '').trim();
  const cleanModel = (model || '').trim();
  const cleanPrio = (prio || '').trim();
  const cleanNotes = (notes || '').trim();

  if (!cleanTokens || !cleanModel || !cleanPrio || !cleanNotes) {
    console.error(`❌ All 4 PO estimation fields are mandatory before an item can be set to Ready!`);
    console.error(`   Provided:`);
    console.error(`   - Priority: "${cleanPrio}"`);
    console.error(`   - Estimated Effort: "${cleanTokens}"`);
    console.error(`   - Assigned Worker Model: "${cleanModel}"`);
    console.error(`   - PO Notes / Plan: "${cleanNotes}"`);
    process.exit(1);
  }

  const body = [
    PO_HEADER,
    `- **Priority:** ${cleanPrio}`,
    `- **Estimated Effort:** \`${cleanTokens}\``,
    `- **Assigned Worker Model:** \`${cleanModel}\``,
    `- **PO Notes / Plan:** ${cleanNotes}`,
  ].join('\n');

  // Check if an existing PO estimation comment exists on this issue; if so, update it in place
  const comments = getIssueComments(issueNumber);
  const existingPoComment = comments.find((c) => c.body && c.body.includes(PO_HEADER));

  if (existingPoComment?.id) {
    const mutation = `
      mutation($id: ID!, $body: String!) {
        updateIssueComment(input: { id: $id, body: $body }) {
          issueComment {
            id
            url
          }
        }
      }
    `;
    const out = runGhArgs([
      'api',
      'graphql',
      '-f',
      `query=${mutation}`,
      '-F',
      `id=${existingPoComment.id}`,
      '-F',
      `body=${body}`,
    ]);
    if (out !== null) {
      console.log(`✅ Updated PO estimation on Issue #${issueNumber} (Effort: ${cleanTokens}, Model: ${cleanModel})`);
      return;
    }
  }

  const out = runGhArgs([
    'issue',
    'comment',
    String(issueNumber),
    '--repo',
    `${OWNER}/${REPO}`,
    '--body-file',
    '-',
  ], body);
  if (out !== null) {
    console.log(`✅ Posted PO estimation on Issue #${issueNumber} (Effort: ${cleanTokens}, Model: ${cleanModel})`);
  }
}

async function cmdCreate(title, body, initialStatus = 'Backlog') {
  if (!isGhAuthenticated()) {
    console.error(`⚠️ Cannot create Issue "${title}": 'gh' CLI not authenticated.`);
    console.error(`   Run: gh auth login -s repo,project`);
    process.exit(1);
  }
  const formattedBody = (body || '').replace(/\\n/g, '\n');
  const issueUrl = runGhArgs(
    ['issue', 'create', '--repo', `${OWNER}/${REPO}`, '--title', title, '--body-file', '-'],
    formattedBody
  );
  if (!issueUrl) {
    console.error(`⚠️ Failed to create issue "${title}".`);
    process.exit(1);
  }
  console.log(`✅ Created Issue: ${issueUrl}`);
  const match = issueUrl.match(/\/issues\/(\d+)$/);
  if (match) {
    const issueNumber = Number(match[1]);
    await cmdSetStatus(issueNumber, initialStatus);
  }
}

const [, , action, ...rest] = process.argv;

if (action === 'list' || !action) {
  await cmdList();
} else if (action === 'create') {
  const [title, body, initialStatus] = rest;
  await cmdCreate(title, body, initialStatus || 'Backlog');
} else if (action === 'status') {
  const [num, statusName] = rest;
  await cmdSetStatus(num, statusName);
} else if (action === 'estimate') {
  const [num, tokens, model, prio, notes] = rest;
  await cmdEstimate(num, tokens, model, prio, notes);
} else {
  console.log(`Usage:
  node .agents/skills/po-board/scripts/gh_board.mjs list
  node .agents/skills/po-board/scripts/gh_board.mjs create "<title>" "<body>" ["<Backlog|Ready|In Progress|In Review|Done>"]
  node .agents/skills/po-board/scripts/gh_board.mjs status <issue_number> "<Backlog|Ready|In Progress|In Review|Done>"
  node .agents/skills/po-board/scripts/gh_board.mjs estimate <issue_number> "<tokens>" "<model>" "<prio>" "<notes>"`);
}
