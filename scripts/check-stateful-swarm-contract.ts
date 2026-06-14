#!/usr/bin/env bun
/**
 * Deterministic contract checks for the AgentV-native document-intelligence target.
 *
 * The checks run the wrapper in STATEFUL_SWARM_MOCK mode, so they never call a
 * model or require provider secrets. They protect two important target
 * contracts:
 * 1. default document context is large enough for the canonical Harvey subset;
 * 2. constrained document context still represents every source document; and
 * 3. .eml files are parsed into email headers/body instead of placeholders.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TASKS = [
  'corporate-ma/extract-change-of-control-provisions',
  'litigation-dispute-resolution/compare-document-production-against-discovery-requests',
  'data-privacy-cybersecurity/assess-breach-notification-obligations-across-affected-jurisdictions',
  'banking-finance/compare-credit-agreement-against-term-sheet',
] as const;

type InventoryEntry = {
  readonly file: string;
  readonly chars: number;
};

type AgentVOutput = {
  readonly text?: string;
  readonly output?: readonly { readonly metadata?: Record<string, unknown> }[];
};

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function harveyRoot(): string {
  return path.resolve(process.env.HARVEY_LABS_REPO_PATH ?? path.join(repoRoot(), '..', 'harvey-labs'));
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

function runWrapper(taskId: string, label: string, extraEnv: Record<string, string> = {}) {
  const root = repoRoot();
  const tmpRoot = path.join(root, 'tmp/stateful-swarm-contract-check');
  mkdirSync(tmpRoot, { recursive: true });
  const promptFile = path.join(tmpRoot, `${safeSegment(label)}.prompt.md`);
  const outputFile = path.join(tmpRoot, `${safeSegment(label)}.agentv-output.json`);
  writeFileSync(promptFile, `You are completing an AgentV adaptation of Harvey LAB task \`${taskId}\`.\n`);

  const result = spawnSync(
    'bun',
    [
      'run',
      path.join(root, 'scripts/run-stateful-swarm-agentv-target.ts'),
      '--eval-id',
      safeSegment(taskId),
      '--prompt-file',
      promptFile,
      '--output-file',
      outputFile,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        LEGAL_DOCUMENT_EVALS_ROOT: root,
        HARVEY_LABS_REPO_PATH: harveyRoot(),
        STATEFUL_SWARM_MOCK: 'true',
        STATEFUL_SWARM_ARTIFACT_ROOT: path.join(tmpRoot, 'artifacts'),
        AGENTV_RUN_TIMESTAMP: label,
        ...extraEnv,
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(`stateful-swarm wrapper failed for ${taskId}:\n${result.stderr || result.stdout}`);
  }

  const runDir = path.join(tmpRoot, 'artifacts', label, safeSegment(taskId));
  return {
    excerpts: readFileSync(path.join(runDir, 'document-excerpts.md'), 'utf8'),
    inventory: JSON.parse(readFileSync(path.join(runDir, 'document-inventory.json'), 'utf8')) as InventoryEntry[],
    workflowSkill: readFileSync(path.join(runDir, 'workflow-skill.md'), 'utf8'),
    blackboard: readFileSync(path.join(runDir, 'blackboard.json'), 'utf8'),
    state: readFileSync(path.join(runDir, 'state.json'), 'utf8'),
    output: JSON.parse(readFileSync(outputFile, 'utf8')) as AgentVOutput,
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEveryDocumentRepresented(taskId: string, label: string, excerpts: string, inventory: readonly InventoryEntry[]): void {
  assert(inventory.length > 0, `${taskId} produced an empty document inventory`);
  for (const doc of inventory) {
    assert(excerpts.includes(`--- ${doc.file} (`), `${label}: ${taskId} omitted ${doc.file} from document-excerpts.md`);
  }
}

function assertEmailExtracted(taskId: string, label: string, excerpts: string, inventory: readonly InventoryEntry[]): void {
  for (const doc of inventory.filter((entry) => entry.file.endsWith('.eml'))) {
    const sectionStart = excerpts.indexOf(`--- ${doc.file} (`);
    assert(sectionStart >= 0, `${label}: ${taskId} omitted email ${doc.file}`);
    const nextSection = excerpts.indexOf('\n\n--- ', sectionStart + 1);
    const section = excerpts.slice(sectionStart, nextSection >= 0 ? nextSection : undefined);
    assert(!section.includes('no extractor configured'), `${label}: ${taskId} left ${doc.file} as an unparsed placeholder`);
    assert(/(^|\n)(From|To|Date|Subject): /m.test(section), `${label}: ${taskId} did not expose email headers for ${doc.file}`);
  }
}

function assertWorkflowWired(taskId: string, label: string, result: ReturnType<typeof runWrapper>): void {
  assert(result.workflowSkill.includes('## Generic document-intelligence workflow'), `${label}: ${taskId} did not persist the generic workflow skill`);
  assert(result.workflowSkill.includes('## Legal specialization'), `${label}: ${taskId} did not persist the legal specialization`);
  assert(result.state.includes('document-intelligence-skill-workflow'), `${label}: ${taskId} state did not record the skill workflow`);
  assert(
    result.output.output?.[0]?.metadata?.agent_behavior === 'document-intelligence-skill-workflow',
    `${label}: ${taskId} AgentV output metadata did not record the skill workflow`,
  );
}

function assertNoCriteriaLeak(taskId: string, label: string, result: ReturnType<typeof runWrapper>): void {
  const inspected = [result.blackboard, result.state, result.output.text ?? ''].join('\n');
  assert(!/PASS if|match_criteria|CRITERIA:/i.test(inspected), `${label}: ${taskId} leaked grader/rubric criteria into target artifacts`);
}

function main(): void {
  const sourceRoot = harveyRoot();
  assert(existsSync(path.join(sourceRoot, 'tasks')), `HARVEY_LABS_REPO_PATH must point at Harvey LAB tasks: ${sourceRoot}`);

  const tmpRoot = path.join(repoRoot(), 'tmp/stateful-swarm-contract-check');
  rmSync(tmpRoot, { recursive: true, force: true });

  for (const taskId of TASKS) {
    const label = `default-${safeSegment(taskId)}`;
    const result = runWrapper(taskId, label);
    assertEveryDocumentRepresented(taskId, label, result.excerpts, result.inventory);
    assertEmailExtracted(taskId, label, result.excerpts, result.inventory);
    assertWorkflowWired(taskId, label, result);
    assertNoCriteriaLeak(taskId, label, result);
  }

  const constrained = runWrapper(TASKS[0], 'constrained-corpus-budget', { STATEFUL_SWARM_MAX_DOC_CHARS: '60000' });
  assertEveryDocumentRepresented(TASKS[0], 'constrained-corpus-budget', constrained.excerpts, constrained.inventory);
  assertWorkflowWired(TASKS[0], 'constrained-corpus-budget', constrained);

  console.log('document-intelligence/stateful-swarm deterministic contract checks passed.');
}

main();
