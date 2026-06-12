#!/usr/bin/env bun
/**
 * AgentV CLI-provider adapter for an Irys-inspired stateful-swarm approximation.
 *
 * This is intentionally not the upstream Irys/stateful-swarms harness. It keeps
 * AgentV eval YAML canonical while approximating the useful harness ideas in a
 * provider-flexible wrapper: ingest documents, build staged plan/extract/analyze
 * state, persist a blackboard artifact, synthesize a final answer, and emit the
 * AgentV CLI-provider JSON contract.
 *
 * Live mode uses an OpenAI-compatible chat-completions endpoint controlled by
 * OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_MODEL. Deterministic mock mode
 * (STATEFUL_SWARM_MOCK=true) exercises the contract without secrets.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_ARTIFACT_ROOT = '.agentv/harness-artifacts/stateful-swarm';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_SECONDS = 600;
const DEFAULT_MAX_DOC_CHARS = 60_000;

type CliArgs = {
  readonly checkOnly: boolean;
  readonly evalId?: string;
  readonly promptFile?: string;
  readonly outputFile?: string;
};

type HarveyTask = {
  readonly title?: string;
  readonly work_type?: string;
  readonly instructions?: string;
  readonly deliverables?: unknown;
  readonly criteria?: readonly { readonly id?: string; readonly title?: string; readonly match_criteria?: string }[];
};

type DocumentExcerpt = {
  readonly file: string;
  readonly text: string;
};

type BlackboardEntry = {
  readonly id: string;
  readonly stage: 'plan' | 'extract' | 'analyze' | 'synthesize';
  readonly content: unknown;
  readonly sources?: readonly string[];
};

type ModelUsage = {
  readonly input: number;
  readonly output: number;
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

function mockMode(): boolean {
  return ['1', 'true', 'yes'].includes((env('STATEFUL_SWARM_MOCK') ?? '').toLowerCase());
}

function checkOnly(): void {
  const failures: string[] = [];
  const evalsRoot = env('LEGAL_DOCUMENT_EVALS_ROOT');
  if (!evalsRoot) {
    failures.push('Set LEGAL_DOCUMENT_EVALS_ROOT to this legal-document-agent-evals checkout.');
  } else if (!existsSync(path.join(path.resolve(evalsRoot), 'scripts/run-stateful-swarm-agentv-target.ts'))) {
    failures.push('LEGAL_DOCUMENT_EVALS_ROOT must point at this checkout with scripts/run-stateful-swarm-agentv-target.ts.');
  }

  if (!mockMode()) {
    if (!env('OPENAI_MODEL')) failures.push('Set OPENAI_MODEL for the stateful-swarm approximation target.');
    if (!env('OPENAI_API_KEY')) failures.push('Set OPENAI_API_KEY for the OpenAI-compatible stateful-swarm target, or set STATEFUL_SWARM_MOCK=true for offline contract checks.');
  }

  if (failures.length > 0) {
    throw new Error([
      'Stateful-swarm approximation target setup is incomplete.',
      ...failures.map((failure) => `- ${failure}`),
      '',
      'No resolved secret values or private endpoints were printed.',
    ].join('\n'));
  }

  console.log(mockMode()
    ? 'Stateful-swarm approximation preflight passed in deterministic mock mode.'
    : 'Stateful-swarm approximation preflight passed for OpenAI-compatible live mode.');
}

function readPrompt(promptFile: string | undefined): string {
  if (!promptFile) throw new Error('Missing --prompt-file from AgentV CLI provider.');
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
    if (match?.[1]) return match[1].trim().replace(/^tasks\//, '').replace(/\/task\.json$/, '');
  }
  throw new Error('Could not determine Harvey LAB task ID from AgentV prompt.');
}

function resolveHarveyRoot(): string {
  const candidates = [
    env('HARVEY_LABS_REPO_PATH') ? path.resolve(env('HARVEY_LABS_REPO_PATH')!) : undefined,
    path.resolve(process.cwd(), 'harvey-labs'),
    path.resolve(repoRoot(), 'harvey-labs'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'tasks'))) return candidate;
  }

  throw new Error('Could not find Harvey LAB source. Set HARVEY_LABS_REPO_PATH, or run through the AgentV eval workspace that clones ./harvey-labs.');
}

function artifactRoot(): string {
  const configured = env('STATEFUL_SWARM_ARTIFACT_ROOT') ?? DEFAULT_ARTIFACT_ROOT;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

function runTimestamp(): string {
  return env('AGENTV_RUN_TIMESTAMP') ?? new Date().toISOString().replace(/[:.]/g, '-');
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

function listDocumentFiles(taskDir: string): string[] {
  const docsDir = path.join(taskDir, 'documents');
  if (!existsSync(docsDir)) return [];
  const results: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) visit(fullPath);
      if (stat.isFile()) results.push(fullPath);
    }
  };
  visit(docsDir);
  return results.sort();
}

function extractDocuments(taskDir: string, files: readonly string[]): readonly DocumentExcerpt[] {
  if (files.length === 0) return [];
  const python = spawnSync('python3', ['-c', PYTHON_EXTRACTOR, ...files], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (python.status !== 0 || !python.stdout.trim()) {
    return files.map((file) => ({
      file: path.relative(taskDir, file),
      text: fallbackText(file),
    }));
  }

  const parsed = JSON.parse(python.stdout) as { file: string; text: string }[];
  return parsed.map((doc) => ({ file: path.relative(taskDir, doc.file), text: doc.text }));
}

function fallbackText(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (['.md', '.txt', '.json', '.csv', '.tsv'].includes(ext)) return readFileSync(file, 'utf8');
  return `(Document ${path.basename(file)} is a native ${ext || 'binary'} file; text extraction failed.)`;
}

function loadTask(taskDir: string): HarveyTask {
  const taskPath = path.join(taskDir, 'task.json');
  if (!existsSync(taskPath)) throw new Error(`Harvey LAB task not found: ${taskPath}`);
  return JSON.parse(readFileSync(taskPath, 'utf8')) as HarveyTask;
}

function deliverableNames(task: HarveyTask): readonly string[] {
  const value = task.deliverables;
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map((item) => String(item));
  return [];
}

function docContext(docs: readonly DocumentExcerpt[]): string {
  const maxChars = numberEnv('STATEFUL_SWARM_MAX_DOC_CHARS') ?? DEFAULT_MAX_DOC_CHARS;
  let remaining = maxChars;
  const sections: string[] = [];
  for (const doc of docs) {
    if (remaining <= 0) break;
    const text = doc.text.slice(0, remaining);
    remaining -= text.length;
    sections.push(`--- ${doc.file} ---\n${text}`);
  }
  return sections.join('\n\n');
}

async function openAiComplete(system: string, user: string): Promise<{ text: string; usage: ModelUsage }> {
  const apiKey = env('OPENAI_API_KEY');
  const model = env('OPENAI_MODEL');
  if (!apiKey || !model) throw new Error('OPENAI_API_KEY and OPENAI_MODEL are required outside STATEFUL_SWARM_MOCK=true.');

  const baseUrl = (env('OPENAI_BASE_URL') ?? DEFAULT_OPENAI_BASE_URL).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: Number(env('STATEFUL_SWARM_TEMPERATURE') ?? '0.1'),
    }),
    signal: AbortSignal.timeout((numberEnv('STATEFUL_SWARM_TIMEOUT_SECONDS') ?? DEFAULT_TIMEOUT_SECONDS) * 1000),
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`OpenAI-compatible request failed (${response.status}): ${body.slice(0, 1000)}`);
  const json = JSON.parse(body) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI-compatible response did not include choices[0].message.content.');
  return {
    text,
    usage: {
      input: json.usage?.prompt_tokens ?? 0,
      output: json.usage?.completion_tokens ?? 0,
    },
  };
}

function mockComplete(label: string, task: HarveyTask, docs: readonly DocumentExcerpt[]): { text: string; usage: ModelUsage } {
  const docNames = docs.map((doc) => doc.file).join(', ') || '(no documents)';
  return {
    text: JSON.stringify({
      stage: label,
      title: task.title ?? 'Untitled Harvey LAB task',
      documents: docNames,
      note: 'deterministic STATEFUL_SWARM_MOCK output',
    }, null, 2),
    usage: { input: 0, output: 0 },
  };
}

async function stagedRun(task: HarveyTask, docs: readonly DocumentExcerpt[]): Promise<{ finalAnswer: string; entries: readonly BlackboardEntry[]; usage: ModelUsage }> {
  const entries: BlackboardEntry[] = [];
  const usage: ModelUsage = { input: 0, output: 0 };
  const addUsage = (next: ModelUsage) => {
    (usage as { input: number; output: number }).input += next.input;
    (usage as { input: number; output: number }).output += next.output;
  };

  const system = 'You are a legal document analysis agent using a staged stateful-swarm workflow. Be precise, cite source filenames, preserve uncertainty, and do not invent facts.';
  const context = docContext(docs);
  const deliverables = deliverableNames(task).join(', ') || 'Markdown answer';
  const criteria = (task.criteria ?? []).slice(0, 80).map((criterion) => `${criterion.id}: ${criterion.title}\n${criterion.match_criteria}`).join('\n\n');

  const complete = async (label: string, user: string) => {
    const result = mockMode() ? mockComplete(label, task, docs) : await openAiComplete(system, user);
    addUsage(result.usage);
    return result.text;
  };

  const plan = await complete('plan', `Task title: ${task.title}\nInstructions: ${task.instructions}\nDeliverables: ${deliverables}\nDocuments: ${docs.map((doc) => doc.file).join(', ')}\n\nCreate a concise investigation plan as JSON.`);
  entries.push({ id: 'plan-001', stage: 'plan', content: parseMaybeJson(plan), sources: docs.map((doc) => doc.file) });

  const extracted = await complete('extract', `Use this investigation plan to extract relevant observations with source filenames. Return JSON entries with source, quote_or_summary, and relevance.\n\nPLAN:\n${plan}\n\nDOCUMENT EXCERPTS:\n${context}`);
  entries.push({ id: 'extract-001', stage: 'extract', content: parseMaybeJson(extracted), sources: docs.map((doc) => doc.file) });

  const analysis = await complete('analyze', `Analyze the extracted observations against the task and criteria. Identify risks, gaps, and provenance-sensitive conclusions.\n\nTASK:\n${task.instructions}\n\nCRITERIA:\n${criteria}\n\nEXTRACTED STATE:\n${extracted}`);
  entries.push({ id: 'analyze-001', stage: 'analyze', content: parseMaybeJson(analysis), sources: docs.map((doc) => doc.file) });

  const finalAnswer = mockMode()
    ? mockFinalAnswer(task, docs, entries)
    : await complete('synthesize', `Synthesize the final answer in Markdown. Create one section per requested deliverable and cite source filenames where feasible.\n\nTASK:\n${task.instructions}\n\nDELIVERABLES:\n${deliverables}\n\nBLACKBOARD STATE:\n${JSON.stringify(entries, null, 2)}`);
  entries.push({ id: 'synthesize-001', stage: 'synthesize', content: finalAnswer, sources: docs.map((doc) => doc.file) });

  return { finalAnswer, entries, usage };
}

function mockFinalAnswer(task: HarveyTask, docs: readonly DocumentExcerpt[], entries: readonly BlackboardEntry[]): string {
  const deliverable = deliverableNames(task)[0] ?? 'stateful-swarm-answer.md';
  return [
    `## ${deliverable}`,
    '',
    `Deterministic STATEFUL_SWARM_MOCK answer for: ${task.title ?? 'Harvey LAB task'}.`,
    '',
    `Documents ingested: ${docs.map((doc) => doc.file).join(', ') || '(none)'}.`,
    '',
    `Blackboard stages persisted: ${entries.map((entry) => entry.stage).join(' -> ')} -> synthesize.`,
  ].join('\n');
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function writeJson(pathName: string, value: unknown): void {
  mkdirSync(path.dirname(pathName), { recursive: true });
  writeFileSync(pathName, JSON.stringify(value, null, 2));
}

function writeAgentVOutput(params: {
  readonly outputFile: string;
  readonly finalAnswer: string;
  readonly evalId?: string;
  readonly harveyTaskId: string;
  readonly runDir: string;
  readonly docs: readonly DocumentExcerpt[];
  readonly entries: readonly BlackboardEntry[];
  readonly usage: ModelUsage;
  readonly durationMs: number;
}): void {
  const metadata = {
    harness: 'agentv-native-stateful-swarm-approximation',
    inspired_by: 'irys-stateful-swarms',
    fidelity: 'approximation_not_upstream_irys',
    harvey_task_id: params.harveyTaskId,
    harness_artifacts: displayRunDir(params.runDir),
    document_count: params.docs.length,
    blackboard_entries: params.entries.length,
    mock_mode: mockMode(),
  };

  const response = {
    text: params.finalAnswer,
    output: [{ role: 'assistant', content: params.finalAnswer, metadata }],
    token_usage: params.usage,
    duration_ms: params.durationMs,
  };
  mkdirSync(path.dirname(params.outputFile), { recursive: true });
  writeFileSync(params.outputFile, JSON.stringify(response, null, 2));
}

function displayRunDir(runDir: string): string {
  const relative = path.relative(repoRoot(), runDir);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : '<external harness artifact directory>';
}

function numberEnv(name: string): number | undefined {
  const value = env(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.checkOnly) {
    checkOnly();
    return;
  }
  if (!args.outputFile) throw new Error('Missing --output-file from AgentV CLI provider.');
  if (!mockMode() && (!env('OPENAI_MODEL') || !env('OPENAI_API_KEY'))) {
    throw new Error('Stateful-swarm approximation live mode requires OPENAI_MODEL and OPENAI_API_KEY. Use STATEFUL_SWARM_MOCK=true for deterministic offline checks.');
  }

  const start = Date.now();
  const prompt = readPrompt(args.promptFile);
  const harveyTaskId = extractHarveyTaskId(prompt);
  const harveyRoot = resolveHarveyRoot();
  const taskDir = path.join(harveyRoot, 'tasks', harveyTaskId);
  const task = loadTask(taskDir);
  const docs = extractDocuments(taskDir, listDocumentFiles(taskDir));
  const runDir = path.join(artifactRoot(), runTimestamp(), safeSegment(args.evalId ?? harveyTaskId));
  mkdirSync(runDir, { recursive: true });

  writeJson(path.join(runDir, 'document-inventory.json'), docs.map((doc) => ({ file: doc.file, chars: doc.text.length })));
  writeFileSync(path.join(runDir, 'document-excerpts.md'), docContext(docs));

  const { finalAnswer, entries, usage } = await stagedRun(task, docs);
  writeJson(path.join(runDir, 'blackboard.json'), { entries });
  writeJson(path.join(runDir, 'state.json'), {
    harness: 'agentv-native-stateful-swarm-approximation',
    inspired_by: 'irys-stateful-swarms',
    fidelity: 'approximation_not_upstream_irys',
    task: { id: harveyTaskId, title: task.title, deliverables: deliverableNames(task) },
    mock_mode: mockMode(),
    usage,
  });
  writeFileSync(path.join(runDir, 'final-answer.md'), finalAnswer);

  writeAgentVOutput({
    outputFile: args.outputFile,
    finalAnswer,
    evalId: args.evalId,
    harveyTaskId,
    runDir,
    docs,
    entries,
    usage,
    durationMs: Date.now() - start,
  });
}

const PYTHON_EXTRACTOR = String.raw`
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}

def xml_texts(node):
    return [el.text or "" for el in node.iter() if el.tag.endswith("}t") or el.tag == "t"] if node is not None else []

def docx(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    return "\n".join("".join(xml_texts(p)).strip() for p in root.findall(".//w:p", NS) if "".join(xml_texts(p)).strip())

def shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return ["".join(xml_texts(si)) for si in root.findall(".//s:si", NS)]

def xlsx(path):
    rows = []
    with zipfile.ZipFile(path) as z:
        strings = shared_strings(z)
        for sheet_name in sorted(name for name in z.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")):
            rows.append(f"=== {sheet_name} ===")
            root = ET.fromstring(z.read(sheet_name))
            for row in root.findall(".//s:row", NS):
                values = []
                for cell in row.findall("s:c", NS):
                    raw = cell.findtext("s:v", default="", namespaces=NS)
                    value = strings[int(raw)] if cell.attrib.get("t") == "s" and raw.isdigit() and int(raw) < len(strings) else raw
                    if cell.attrib.get("t") == "inlineStr":
                        value = "".join(xml_texts(cell.find("s:is", NS)))
                    values.append(value)
                if any(values):
                    rows.append("\t".join(values))
    return "\n".join(rows)

def pptx(path):
    lines = []
    with zipfile.ZipFile(path) as z:
        for slide_name in sorted(name for name in z.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml")):
            text = "\n".join(t for t in xml_texts(ET.fromstring(z.read(slide_name))) if t.strip())
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
        return Path(path).read_text(encoding="utf-8", errors="replace")
    return f"(Native {suffix or 'binary'} file preserved at {Path(path).name}; no extractor configured.)"

print(json.dumps([{"file": path, "text": extract(path)} for path in sys.argv[1:]]))
`;

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
