#!/usr/bin/env bun
/**
 * AgentV CLI-provider adapter for the exact upstream Irys/stateful-swarms Harvey LAB harness.
 *
 * This keeps AgentV as the portable eval/result layer while delegating legal
 * document execution to the upstream harness used in the research notes:
 *
 *   AgentV eval case -> this CLI target -> `irys run <harvey task dir>`
 *
 * Current inspected Irys source routes `irys run` through GeminiCaller, so
 * this optional upstream target requires GEMINI_API_KEY, GOOGLE_API_KEY, or GEMINI_API_KEYS.
 *
 * The wrapper writes two outputs:
 * - Native Irys/Harvey artifacts under `.agentv/harness-artifacts/irys-upstream/`
 *   (blackboard snapshots, survival traces, deliverable files, metrics/status,
 *   and optional Harvey `scores.json` if scoring is enabled).
 * - A text response JSON at AgentV's `{OUTPUT_FILE}` path so the existing
 *   AgentV llm-grader can grade the same canonical eval suite.
 *
 * To add another harness-backed target, copy this adapter shape: resolve the
 * canonical AgentV test to an upstream task, run the harness, preserve native
 * artifacts outside the temp workspace, and emit AgentV's small CLI-provider
 * JSON contract at the boundary.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_ARTIFACT_ROOT = '.agentv/harness-artifacts/irys-upstream';
const DEFAULT_IRYS_TIMEOUT_SECONDS = 60 * 60;

type CliArgs = {
  readonly checkOnly: boolean;
  readonly evalId?: string;
  readonly promptFile?: string;
  readonly outputFile?: string;
};

type CommandResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
};

type HarnessPaths = {
  readonly outputRoot: string;
  readonly runDir?: string;
  readonly outputDir?: string;
  readonly statusPath?: string;
  readonly metricsPath?: string;
  readonly scoresPath?: string;
  readonly relativeRunDir?: string;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let checkOnly = false;
  let evalId: string | undefined;
  let promptFile: string | undefined;
  let outputFile: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--check-only') {
      checkOnly = true;
    } else if (arg === '--eval-id' && next) {
      evalId = next;
      i += 1;
    } else if (arg === '--prompt-file' && next) {
      promptFile = next;
      i += 1;
    } else if (arg === '--output-file' && next) {
      outputFile = next;
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return { checkOnly, evalId, promptFile, outputFile };
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function hasIrysCredential(): boolean {
  return Boolean(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY') || env('GEMINI_API_KEYS'));
}

function credentialHelp(): string {
  return 'Set GEMINI_API_KEY, GOOGLE_API_KEY, or GEMINI_API_KEYS for the Irys provider.';
}

function childEnv(): NodeJS.ProcessEnv {
  const next = { ...process.env };
  if (!env('GEMINI_API_KEY') && !env('GOOGLE_API_KEY')) {
    const firstGeminiKey = env('GEMINI_API_KEYS')
      ?.split(',')
      .map((key) => key.trim())
      .find(Boolean);
    if (firstGeminiKey) {
      next.GEMINI_API_KEY = firstGeminiKey;
    }
  }
  return next;
}

function irysCommandArgs(subcommandArgs: readonly string[]): readonly string[] {
  const irysRepoPath = env('IRYS_STATEFUL_SWARMS_REPO_PATH');
  if (irysRepoPath) {
    return [
      env('UV_EXECUTABLE') ?? 'uv',
      'run',
      '--project',
      path.resolve(irysRepoPath),
      'python',
      '-m',
      'src.cli',
      ...subcommandArgs,
    ];
  }

  return [env('IRYS_EXECUTABLE') ?? 'irys', ...subcommandArgs];
}

function irysWorkingDirectory(): string | undefined {
  const irysRepoPath = env('IRYS_STATEFUL_SWARMS_REPO_PATH');
  return irysRepoPath ? path.resolve(irysRepoPath) : undefined;
}

function runCommand(args: readonly string[], timeoutSeconds?: number, cwd?: string): CommandResult {
  const [command, ...rest] = args;
  if (!command) throw new Error('Cannot run empty command');
  const result = spawnSync(command, rest, {
    encoding: 'utf8',
    timeout: secondsToMilliseconds(timeoutSeconds),
    env: childEnv(),
    cwd,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error instanceof Error ? result.error : undefined,
  };
}

function secondsToMilliseconds(timeoutSeconds: number | undefined): number {
  const seconds =
    typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds
      : DEFAULT_IRYS_TIMEOUT_SECONDS;
  return Math.max(1, seconds) * 1000;
}

function assertOk(result: CommandResult, label: string): void {
  if (result.status === 0 && !result.error) return;
  const detail = [result.stderr.trim(), result.stdout.trim(), result.error?.message]
    .filter(Boolean)
    .join('\n');
  throw new Error(`${label} failed${detail ? `:\n${detail}` : ''}`);
}

function checkOnly(): void {
  const failures: string[] = [];

  if (!env('LEGAL_DOCUMENT_EVALS_ROOT')) {
    failures.push(
      'Set LEGAL_DOCUMENT_EVALS_ROOT to this legal-document-agent-evals checkout. ' +
        'AgentV workspace targets execute from temp workspaces, so the wrapper path must be absolute.',
    );
  }

  const irysRepoPath = env('IRYS_STATEFUL_SWARMS_REPO_PATH');
  if (irysRepoPath) {
    const absolute = path.resolve(irysRepoPath);
    if (!existsSync(path.join(absolute, 'pyproject.toml'))) {
      failures.push(`IRYS_STATEFUL_SWARMS_REPO_PATH must point at the Irys checkout: ${irysRepoPath}`);
    }
  }

  if (!hasIrysCredential()) {
    failures.push(credentialHelp());
  }

  if (failures.length > 0) {
    throw new Error(
      [
        'Upstream Irys/stateful-swarms target setup is incomplete.',
        ...failures.map((failure) => `- ${failure}`),
        '',
        'No resolved secret values or private endpoints were printed.',
      ].join('\n'),
    );
  }

  const help = runCommand(irysCommandArgs(['--help']), 30, irysWorkingDirectory());
  assertOk(help, 'Irys CLI preflight');
  console.log('Upstream Irys/stateful-swarms target preflight passed.');
}

function readPrompt(promptFile: string | undefined): string {
  if (!promptFile) {
    throw new Error('Missing --prompt-file from AgentV CLI provider.');
  }
  return readFileSync(promptFile, 'utf8');
}

function extractHarveyTaskId(prompt: string): string {
  const patterns = [
    /Harvey LAB task `([^`]+)`/i,
    /tasks\/([^`\s]+\/[^`\s]+(?:\/[^`\s]+)?)\/documents/i,
    /source_path:\s*["']?tasks\/([^"'\n]+)\/task\.json/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/^tasks\//, '').replace(/\/task\.json$/, '');
    }
  }

  throw new Error(
    'Could not determine Harvey LAB task ID from AgentV prompt. ' +
      'Expected prompt text like: Harvey LAB task `practice-area/task-slug`.',
  );
}

function resolveHarveyRoot(): string {
  const explicit = env('HARVEY_LABS_REPO_PATH');
  const candidates = [
    explicit ? path.resolve(explicit) : undefined,
    path.resolve(process.cwd(), 'harvey-labs'),
    path.resolve(repoRoot(), 'harvey-labs'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'tasks'))) {
      return candidate;
    }
  }

  throw new Error(
    'Could not find Harvey LAB source. Set HARVEY_LABS_REPO_PATH, or run through ' +
      'the AgentV eval workspace that clones ./harvey-labs.',
  );
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function artifactRoot(): string {
  const configured = env('IRYS_AGENTV_ARTIFACT_ROOT') ?? DEFAULT_ARTIFACT_ROOT;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

function runTimestamp(): string {
  return env('AGENTV_RUN_TIMESTAMP') ?? new Date().toISOString().replace(/[:.]/g, '-');
}

function runIrys(taskDir: string, outputRoot: string): CommandResult {
  const args = ['run', taskDir, '--output', outputRoot];
  const workerModel = env('SWARM_WORKER_MODEL');
  const synthesisModel = env('SWARM_SYNTHESIS_MODEL');
  if (workerModel) args.push('--worker-model', workerModel);
  if (synthesisModel) args.push('--synthesis-model', synthesisModel);
  return runCommand(
    irysCommandArgs(args),
    numberEnv('IRYS_TIMEOUT_SECONDS') ?? DEFAULT_IRYS_TIMEOUT_SECONDS,
    irysWorkingDirectory(),
  );
}

function maybeScoreIrys(outputRoot: string, harveyRoot: string): CommandResult | undefined {
  const enabled = (env('IRYS_SCORE_AFTER_RUN') ?? '').toLowerCase();
  if (!['1', 'true', 'yes'].includes(enabled)) return undefined;

  const args = [
    'score',
    outputRoot,
    '--bench-root',
    harveyRoot,
    '--task-concurrency',
    env('IRYS_SCORE_TASK_CONCURRENCY') ?? '1',
    '--concurrency',
    env('IRYS_SCORE_CRITERIA_CONCURRENCY') ?? '4',
  ];
  const judgeModel = env('IRYS_JUDGE_MODEL');
  if (judgeModel) args.push('--judge-model', judgeModel);
  return runCommand(
    irysCommandArgs(args),
    numberEnv('IRYS_SCORE_TIMEOUT_SECONDS') ?? DEFAULT_IRYS_TIMEOUT_SECONDS,
    irysWorkingDirectory(),
  );
}

function findHarnessPaths(outputRoot: string): HarnessPaths {
  const statusFiles = findFiles(outputRoot, 'status.json');
  const statusPath = statusFiles[0];
  const runDir = statusPath ? path.dirname(statusPath) : undefined;
  const outputDir = runDir ? path.join(runDir, 'output') : undefined;
  const metricsPath = runDir && existsSync(path.join(runDir, 'metrics.json'))
    ? path.join(runDir, 'metrics.json')
    : undefined;
  const scoresPath = runDir && existsSync(path.join(runDir, 'scores.json'))
    ? path.join(runDir, 'scores.json')
    : undefined;

  return {
    outputRoot,
    runDir,
    outputDir: outputDir && existsSync(outputDir) ? outputDir : undefined,
    statusPath,
    metricsPath,
    scoresPath,
    relativeRunDir: runDir ? displayHarnessRunDir(outputRoot, runDir) : undefined,
  };
}

function displayHarnessRunDir(outputRoot: string, runDir: string): string {
  const repoRelative = path.relative(repoRoot(), runDir);
  if (repoRelative && !repoRelative.startsWith('..') && !path.isAbsolute(repoRelative)) {
    return repoRelative;
  }

  const outputRelative = path.relative(outputRoot, runDir);
  if (outputRelative && !outputRelative.startsWith('..') && !path.isAbsolute(outputRelative)) {
    return path.join('<artifact-root>', outputRelative);
  }

  return '<external harness artifact directory>';
}

function findFiles(root: string, basename: string): string[] {
  const results: string[] = [];
  if (!existsSync(root)) return results;

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        visit(fullPath);
      } else if (entry === basename) {
        results.push(fullPath);
      }
    }
  };

  visit(root);
  return results.sort();
}

function listOutputFiles(outputDir: string | undefined): string[] {
  if (!outputDir || !existsSync(outputDir)) return [];
  return readdirSync(outputDir)
    .map((entry) => path.join(outputDir, entry))
    .filter((entry) => statSync(entry).isFile())
    .sort();
}

function extractTextFromFiles(files: readonly string[]): string {
  if (files.length === 0) return '(No Irys deliverable files found.)';

  const python = spawnSync('python3', ['-c', PYTHON_EXTRACTOR, ...files], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (python.status === 0 && python.stdout.trim()) {
    return python.stdout.trim();
  }

  const fallbackSections = files.map((file) => {
    const ext = path.extname(file).toLowerCase();
    if (['.md', '.txt', '.json', '.csv'].includes(ext)) {
      return `## ${path.basename(file)}\n${readFileSync(file, 'utf8')}`;
    }
    return `## ${path.basename(file)}\n(Native ${ext || 'binary'} deliverable saved at ${path.basename(file)}; text extraction failed.)`;
  });
  return fallbackSections.join('\n\n');
}

function readJsonFile(filePath: string | undefined): unknown {
  if (!filePath || !existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeAgentVOutput(params: {
  readonly outputFile: string;
  readonly text: string;
  readonly evalId?: string;
  readonly harveyTaskId: string;
  readonly paths: HarnessPaths;
  readonly outputFiles: readonly string[];
  readonly status: unknown;
  readonly metrics: unknown;
  readonly scores: unknown;
}): void {
  const metadata = {
    harness: 'irys-stateful-swarms',
    harvey_task_id: params.harveyTaskId,
    harness_artifacts: params.paths.relativeRunDir,
    deliverable_files: params.outputFiles.map((file) =>
      params.paths.runDir ? path.relative(params.paths.runDir, file) : path.basename(file),
    ),
    status: params.status,
    metrics: params.metrics,
    harvey_scores: params.scores,
  };

  const response = {
    text: [
      `# Upstream Irys/stateful-swarms Harvey LAB output`,
      ``,
      `AgentV test: ${params.evalId ?? '(unknown)'}`,
      `Harvey LAB task: ${params.harveyTaskId}`,
      params.paths.relativeRunDir ? `Harness artifacts: ${params.paths.relativeRunDir}` : undefined,
      ``,
      params.text,
    ]
      .filter(Boolean)
      .join('\n'),
    output: [
      {
        role: 'assistant',
        content: params.text,
        metadata,
      },
    ],
    token_usage: tokenUsageFromMetrics(params.metrics),
    cost_usd: costFromMetrics(params.metrics),
    duration_ms: durationMsFromMetrics(params.metrics),
  };

  mkdirSync(path.dirname(params.outputFile), { recursive: true });
  writeFileSync(params.outputFile, JSON.stringify(response, null, 2));
}

function tokenUsageFromMetrics(metrics: unknown): { input: number; output: number } | undefined {
  if (!metrics || typeof metrics !== 'object') return undefined;
  const record = metrics as Record<string, unknown>;
  const input = numberValue(record.input_tokens);
  const output = numberValue(record.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  return { input: input ?? 0, output: output ?? 0 };
}

function costFromMetrics(metrics: unknown): number | undefined {
  if (!metrics || typeof metrics !== 'object') return undefined;
  return numberValue((metrics as Record<string, unknown>).cost_total_usd);
}

function durationMsFromMetrics(metrics: unknown): number | undefined {
  if (!metrics || typeof metrics !== 'object') return undefined;
  const seconds = numberValue((metrics as Record<string, unknown>).wall_clock_seconds);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberEnv(name: string): number | undefined {
  const value = env(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.checkOnly) {
    checkOnly();
    return;
  }

  if (!args.outputFile) {
    throw new Error('Missing --output-file from AgentV CLI provider.');
  }
  if (!hasIrysCredential()) {
    throw new Error(`Upstream Irys/stateful-swarms credentials are missing. ${credentialHelp()}`);
  }

  const prompt = readPrompt(args.promptFile);
  const harveyTaskId = extractHarveyTaskId(prompt);
  const harveyRoot = resolveHarveyRoot();
  const taskDir = path.join(harveyRoot, 'tasks', harveyTaskId);
  if (!existsSync(path.join(taskDir, 'task.json'))) {
    throw new Error(`Harvey LAB task not found: ${taskDir}`);
  }

  const outputRoot = path.join(artifactRoot(), runTimestamp(), safeSegment(args.evalId ?? harveyTaskId));
  mkdirSync(outputRoot, { recursive: true });

  const runResult = runIrys(taskDir, outputRoot);
  assertOk(runResult, 'Irys run');

  const scoreResult = maybeScoreIrys(outputRoot, harveyRoot);
  if (scoreResult) {
    assertOk(scoreResult, 'Irys/Harvey score');
  }

  const paths = findHarnessPaths(outputRoot);
  const outputFiles = listOutputFiles(paths.outputDir);
  const text = extractTextFromFiles(outputFiles);
  writeAgentVOutput({
    outputFile: args.outputFile,
    text,
    evalId: args.evalId,
    harveyTaskId,
    paths,
    outputFiles,
    status: readJsonFile(paths.statusPath),
    metrics: readJsonFile(paths.metricsPath),
    scores: readJsonFile(paths.scoresPath),
  });
}

const PYTHON_EXTRACTOR = String.raw`
import csv
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
}

def text_file(path):
    return Path(path).read_text(encoding="utf-8", errors="replace")

def xml_texts(node):
    return [el.text or "" for el in node.iter() if el.tag.endswith("}t") or el.tag == "t"]

def docx(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    lines = []
    for p in root.findall(".//w:p", NS):
        text = "".join(xml_texts(p)).strip()
        if text:
            lines.append(text)
    return "\n".join(lines)

def shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return ["".join(xml_texts(si)) for si in root.findall(".//s:si", NS)]

def xlsx(path):
    rows = []
    with zipfile.ZipFile(path) as z:
        strings = shared_strings(z)
        sheet_names = sorted(name for name in z.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))
        for sheet_name in sheet_names:
            rows.append(f"=== {sheet_name} ===")
            root = ET.fromstring(z.read(sheet_name))
            for row in root.findall(".//s:row", NS):
                values = []
                for cell in row.findall("s:c", NS):
                    value = ""
                    if cell.attrib.get("t") == "s":
                        raw = cell.findtext("s:v", default="", namespaces=NS)
                        value = strings[int(raw)] if raw.isdigit() and int(raw) < len(strings) else raw
                    elif cell.attrib.get("t") == "inlineStr":
                        inline = cell.find("s:is", NS)
                        value = "".join(xml_texts(inline)) if inline is not None else ""
                    else:
                        value = cell.findtext("s:v", default="", namespaces=NS)
                    values.append(value)
                if any(values):
                    rows.append("\t".join(values))
    return "\n".join(rows)

def pptx(path):
    lines = []
    with zipfile.ZipFile(path) as z:
        slide_names = sorted(name for name in z.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        for slide_name in slide_names:
            root = ET.fromstring(z.read(slide_name))
            text = "\n".join(t for t in xml_texts(root) if t.strip())
            if text.strip():
                lines.append(f"=== {slide_name} ===\n{text}")
    return "\n\n".join(lines)

def extract(path):
    suffix = Path(path).suffix.lower()
    if suffix == ".docx":
        return docx(path)
    if suffix == ".xlsx":
        return xlsx(path)
    if suffix == ".pptx":
        return pptx(path)
    if suffix in {".md", ".txt", ".json", ".csv", ".tsv"}:
        return text_file(path)
    return f"(Native {suffix or 'binary'} deliverable preserved at {Path(path).name}; no text extractor configured.)"

for path in sys.argv[1:]:
    print(f"## {Path(path).name}")
    try:
        print(extract(path))
    except Exception as exc:
        print(f"(error extracting text: {exc})")
    print()
`;

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
