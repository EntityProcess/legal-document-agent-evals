#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HARVEY_PINNED_COMMIT = '38936c4f07aa20c84b79abff7b4ad82d1f5902a9';
const SOURCE_REPO = 'https://github.com/harveyai/harvey-labs';

const DEFAULT_TASKS = [
  'corporate-ma/extract-change-of-control-provisions',
  'litigation-dispute-resolution/compare-document-production-against-discovery-requests',
  'data-privacy-cybersecurity/assess-breach-notification-obligations-across-affected-jurisdictions',
  'banking-finance/compare-credit-agreement-against-term-sheet',
] as const;

type HarveyCriterion = {
  readonly id?: string;
  readonly title?: string;
  readonly match_criteria?: string;
  readonly deliverables?: readonly string[];
};

type HarveyTask = {
  readonly title: string;
  readonly instructions: string;
  readonly work_type?: string;
  readonly tags?: readonly string[];
  readonly deliverables?: Record<string, string>;
  readonly criteria?: readonly HarveyCriterion[];
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function parseArgs() {
  const tasks: string[] = [];
  let out = 'evals/legal-document-agent.eval.yaml';
  let sample: number | undefined;

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];
    if (arg === '--out' && next) {
      out = next;
      i += 1;
    } else if (arg === '--task' && next) {
      tasks.push(next.replace(/^tasks\//, '').replace(/\/task\.json$/, ''));
      i += 1;
    } else if (arg === '--sample' && next) {
      sample = Number.parseInt(next, 10);
      i += 1;
    }
  }

  const selectedTasks = tasks.length > 0 ? tasks : [...DEFAULT_TASKS];
  return {
    out,
    tasks:
      sample !== undefined && Number.isFinite(sample)
        ? selectedTasks.slice(0, Math.max(0, sample))
        : selectedTasks,
  };
}

function runGit(args: readonly string[], cwd: string): string | undefined {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function requirePinnedSource(repoPath: string, expectedCommit: string): void {
  const actual = runGit(['rev-parse', 'HEAD'], repoPath);
  if (!actual) {
    throw new Error(`HARVEY_LABS_REPO_PATH is not a git checkout: ${repoPath}`);
  }
  if (actual !== expectedCommit) {
    throw new Error(`Harvey LAB checkout must be pinned to ${expectedCommit}; got ${actual}`);
  }
}

function slugTaskId(taskId: string): string {
  return taskId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

function block(value: string, indent = 6): string {
  const spaces = ' '.repeat(indent);
  return value
    .trim()
    .split('\n')
    .map((line) => {
      const trimmed = line.trimEnd();
      return trimmed ? `${spaces}${trimmed}` : '';
    })
    .join('\n');
}

function yamlString(value: string, indent = 12): string {
  const text = value.trim();
  if (!text.includes('\n') && text.length <= 96) {
    return JSON.stringify(text);
  }

  const spaces = ' '.repeat(indent);
  return `|\n${text
    .split('\n')
    .map((line) => {
      const trimmed = line.trimEnd();
      return trimmed ? `${spaces}${trimmed}` : '';
    })
    .join('\n')}`;
}

function renderInput(taskId: string, task: HarveyTask): string {
  const deliverables = Object.keys(task.deliverables ?? {});
  return `You are completing an AgentV adaptation of Harvey LAB task \`${taskId}\`.

Source documents are available in the workspace at:
\`harvey-labs/tasks/${taskId}/documents/\`

Read the source documents before answering. Use the task instructions below and return the work product as Markdown. If the original task requests DOCX/XLSX deliverables, create one Markdown section per deliverable using a heading like \`## ${deliverables[0] ?? 'deliverable'}\`.

Original Harvey LAB instructions:
${task.instructions.trim()}

Expected deliverables:
${deliverables.map((name) => `- ${name}`).join('\n') || '- final-answer.md'}
`;
}

function renderTask(repoPath: string, taskId: string): string {
  const taskJsonPath = path.join(repoPath, 'tasks', taskId, 'task.json');
  const task = JSON.parse(readFileSync(taskJsonPath, 'utf8')) as HarveyTask;
  const criteria = task.criteria ?? [];
  if (criteria.length === 0) {
    throw new Error(`Harvey LAB task has no criteria: ${taskId}`);
  }

  const deliverables = Object.keys(task.deliverables ?? {});
  const input = renderInput(taskId, task);
  const rubricItems = criteria
    .map((criterion, index) => {
      const criterionId = criterion.id ?? `C-${String(index + 1).padStart(3, '0')}`;
      const title = criterion.title?.trim() || criterionId;
      const matchCriteria = criterion.match_criteria?.trim();
      if (!matchCriteria) {
        throw new Error(`Criterion ${criterionId} in ${taskId} is missing match_criteria`);
      }
      const appliesTo = criterion.deliverables?.length
        ? `\nApplies to deliverables: ${criterion.deliverables.join(', ')}`
        : '';
      return `          - id: ${JSON.stringify(criterionId)}\n            operator: correctness\n            outcome: ${yamlString(`${title}\n${matchCriteria}${appliesTo}`, 14)}`;
    })
    .join('\n');

  return `  - id: ${slugTaskId(taskId)}\n    metadata:\n      harvey_task_id: ${JSON.stringify(taskId)}\n      harvey_title: ${JSON.stringify(task.title)}\n      harvey_work_type: ${JSON.stringify(task.work_type ?? '')}\n      harvey_tags: ${JSON.stringify(task.tags ?? [])}\n      harvey_deliverables: ${JSON.stringify(deliverables)}\n      harvey_criteria_count: ${criteria.length}\n      source_path: ${JSON.stringify(`tasks/${taskId}/task.json`)}\n    criteria: ${yamlString(`Complete the Harvey LAB task '${task.title}' and satisfy every source rubric criterion.`, 6)}\n    input: |\n${block(input)}\n    assertions:\n      - name: harvey-lab-rubric\n        type: llm-grader\n        prompt: file://prompts/harvey-lab-grader.md\n        rubrics:\n${rubricItems}`;
}

function renderEval(repoPath: string, tasks: readonly string[], sourceCommit: string): string {
  const sparsePaths = tasks.map((task) => `          - tasks/${task}`).join('\n');
  const tests = tasks.map((task) => renderTask(repoPath, task)).join('\n\n');

  return `name: legal-document-agent\ndescription: |\n  AgentV adaptation of selected Harvey Legal Agent Benchmark (LAB) public tasks.\n  Source: ${SOURCE_REPO} at commit ${sourceCommit}.\n  The suite exercises document-heavy legal work products using Harvey task\n  instructions, source documents, deliverable names, and rubric criteria. It is\n  intentionally a conservative initial subset, not a replacement for Harvey's\n  native sandbox harness or full 1,251-task benchmark.\n\nexecution:\n  target: legal-document-agent\n  workers: 1\n\ntags: [legal-document-agent, harvey-lab, legal, document-intelligence, generated]\n\nmetadata:\n  source_repo: ${SOURCE_REPO}\n  source_commit: ${sourceCommit}\n  source_task_root: tasks\n  adaptation: markdown-deliverable-output\n\nworkspace:\n  mode: temp\n  repos:\n    - path: ./harvey-labs\n      source:\n        type: git\n        url: ${SOURCE_REPO}.git\n      checkout:\n        ref: ${sourceCommit}\n        resolve: local\n      clone:\n        depth: 1\n        sparse:\n${sparsePaths}\n\ntests:\n${tests}\n`;
}

const args = parseArgs();
const repoPath = path.resolve(env('HARVEY_LABS_REPO_PATH') ?? '../harvey-labs');
const sourceCommit = env('HARVEY_LABS_COMMIT') ?? HARVEY_PINNED_COMMIT;
requirePinnedSource(repoPath, sourceCommit);
writeFileSync(args.out, renderEval(repoPath, args.tasks, sourceCommit));
console.log(`Wrote ${args.tasks.length} Harvey LAB-derived AgentV tests to ${args.out}`);
