#!/usr/bin/env bun
import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HARVEY_PINNED_COMMIT = '38936c4f07aa20c84b79abff7b4ad82d1f5902a9';

type Check = {
  readonly ok: boolean;
  readonly message: string;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function run(command: string, args: readonly string[], cwd?: string) {
  return spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function checkHarveyRepo(repoPath: string | undefined): Check[] {
  if (!repoPath) {
    return [{ ok: false, message: 'Set HARVEY_LABS_REPO_PATH to a local Harvey LAB checkout.' }];
  }

  const absolutePath = path.resolve(repoPath);
  const checks: Check[] = [];
  checks.push({ ok: existsSync(absolutePath), message: `HARVEY_LABS_REPO_PATH must exist: ${repoPath}` });
  checks.push({
    ok: existsSync(path.join(absolutePath, 'tasks')),
    message: 'HARVEY_LABS_REPO_PATH must point at a Harvey LAB checkout with a tasks/ directory.',
  });
  checks.push({
    ok: existsSync(path.join(absolutePath, 'tasks/corporate-ma/extract-change-of-control-provisions/task.json')),
    message: 'HARVEY_LABS_REPO_PATH is missing the selected source task fixtures.',
  });

  const git = run('git', ['rev-parse', 'HEAD'], absolutePath);
  if (git.status === 0) {
    const actualCommit = git.stdout.trim();
    const expectedCommit = env('HARVEY_LABS_COMMIT') ?? HARVEY_PINNED_COMMIT;
    checks.push({
      ok: actualCommit === expectedCommit,
      message: `Harvey LAB checkout should be pinned to ${expectedCommit}. Current checkout is a different commit.`,
    });
  } else {
    checks.push({
      ok: false,
      message: 'HARVEY_LABS_REPO_PATH must be a git checkout so the pinned Harvey LAB commit can be verified.',
    });
  }

  return checks;
}

function providerChecks(): Check[] {
  const agentTarget = env('AGENT_TARGET') ?? 'legal-document-agent';
  const checks: Check[] = [];

  if (agentTarget === 'legal-document-agent' || agentTarget === 'codex') {
    checks.push(
      { ok: Boolean(env('CODEX_EXECUTABLE')), message: 'Set CODEX_EXECUTABLE for the coding-agent target.' },
      { ok: Boolean(env('CODEX_MODEL')), message: 'Set CODEX_MODEL for the coding-agent target.' },
    );
  }

  const graderTarget = env('GRADER_TARGET') ?? 'openai-grader';
  if (graderTarget === 'openai-grader') {
    checks.push({ ok: Boolean(env('OPENAI_MODEL')), message: 'Set OPENAI_MODEL for the AgentV grader target.' });
  }
  if (graderTarget === 'azure-grader') {
    checks.push({ ok: Boolean(env('AZURE_OPENAI_ENDPOINT')), message: 'Set AZURE_OPENAI_ENDPOINT for azure-grader.' });
    checks.push({ ok: Boolean(env('AZURE_OPENAI_API_KEY')), message: 'Set AZURE_OPENAI_API_KEY for azure-grader.' });
    checks.push({ ok: Boolean(env('AZURE_DEPLOYMENT_NAME')), message: 'Set AZURE_DEPLOYMENT_NAME for azure-grader.' });
  }

  return checks;
}

function ensureLocalDirectories(): void {
  for (const dir of [env('CODEX_LOG_DIR')]) {
    if (dir) mkdirSync(path.resolve(dir), { recursive: true });
  }
}

function main() {
  const checkSource = process.argv.includes('--check-source');
  const checks = [
    { ok: existsSync('.agentv/targets.yaml'), message: '.agentv/targets.yaml must exist.' },
    { ok: existsSync('evals/legal-document-agent.eval.yaml'), message: 'evals/legal-document-agent.eval.yaml must exist.' },
    ...(checkSource ? checkHarveyRepo(env('HARVEY_LABS_REPO_PATH')) : []),
    ...providerChecks(),
  ];
  const failures = checks.filter((check) => !check.ok);

  if (failures.length > 0) {
    console.error('legal-document-agent-evals AgentV setup is incomplete.');
    console.error('Missing or invalid prerequisites:');
    for (const failure of failures) {
      console.error(`- ${failure.message}`);
    }
    console.error('');
    console.error('No resolved secret values, private endpoints, or provider tokens were printed.');
    process.exit(1);
  }

  if (!process.argv.includes('--check-only')) {
    ensureLocalDirectories();
    console.log('legal-document-agent-evals AgentV setup check passed.');
    console.log(`Harvey LAB source commit: ${env('HARVEY_LABS_COMMIT') ?? HARVEY_PINNED_COMMIT}`);
  }
}

main();
