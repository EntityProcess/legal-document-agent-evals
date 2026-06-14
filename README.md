# legal-document-intelligence-evals

AgentV eval project for public legal/document-intelligence agents.

This repository is an AgentV adaptation of a small, representative subset of [Harvey LAB](https://github.com/harveyai/harvey-labs), the Legal Agent Benchmark. It is broad enough for Harvey LAB-style legal/document intelligence (diligence, litigation discovery, privacy incident response, financing document comparison) without implying coverage of every possible legal-agent task.

Harvey LAB remains the source dataset and native harness. This repo provides portable AgentV eval definitions, targets, prompts, wrapper scripts, and result-pack configuration.

The intended shape is:

> Stop building bespoke eval frameworks. Build portable eval packs on AgentV.

Users still write eval suites, graders, fixtures, adapters, and result packs. AgentV should not absorb Harvey/Irys-specific benchmark shape into core; this repo keeps the eval YAML canonical and swaps target implementations at the AgentV boundary.

## Architecture: eval harness, skill workflow, domain benchmark

This repo intentionally separates three layers:

1. **AgentV = eval harness.** AgentV owns the eval YAML, workspace materialization, target switching, traces/results, grading, and Dashboard/result inspection.
2. **Document-intelligence skill workflow = target agent behavior.** `skills/document-intelligence/SKILL.md` defines a reusable generic-first workflow for document analysis: plan before deep reading, maintain a lightweight blackboard, track evidence/source custody, normalize entities, compare documents, record signals/open questions, close gaps, and verify the final answer without grader/criteria leakage.
3. **Legal-document eval pack = domain benchmark.** The Harvey LAB subset supplies legal tasks, documents, deliverable names, and grading rubrics. Legal guidance is isolated as a specialization inside the skill instead of being built into AgentV core.

The AgentV-native target reads the skill text and uses it as the behavior contract for the staged document-intelligence run. Upstream Irys/stateful-swarms remains inspiration/reference for the workflow pattern, not deterministic acceptance for this repo.


## Baseline results

A public baseline report is available in [BASELINE_RESULTS.md](BASELINE_RESULTS.md). It explains the live `document-intelligence` run, per-case scores, `.eml` coverage, limitations, and how the published AgentV artifacts demonstrate the eval-pack pattern. The published dashboard-style static report is served at https://entityprocess.github.io/legal-document-intelligence-evals-results/.

## Source pin

The initial suite is pinned to Harvey LAB commit:

```text
38936c4f07aa20c84b79abff7b4ad82d1f5902a9
```

Harvey LAB at that commit uses:

- task directories under `tasks/<practice-area>/<task>/...`
- `task.json` fields: `title`, `work_type`, `tags`, `instructions`, `deliverables`, `criteria`
- source documents under each task's `documents/` directory
- rubric criteria with `id`, `title`, `match_criteria`, and relevant `deliverables`
- all-pass scoring in the native harness, with each rubric criterion judged independently

This AgentV adaptation keeps the source task instructions, deliverable names, tags, and rubric criteria. It materializes the pinned Harvey LAB repo into the AgentV workspace.

Targets decide how the work is executed:

- `legal-document-agent` asks a Codex-style coding agent to read the workspace documents and return Markdown sections for the requested deliverables.
- `legal-document-agent-stateful-swarm` is the primary AgentV-native document-intelligence skill workflow target. It reads `skills/document-intelligence/SKILL.md`, ingests task documents, runs staged plan/extract/analyze/synthesize prompts through an OpenAI-compatible endpoint, persists the workflow skill plus blackboard/state artifacts, and emits AgentV CLI-provider JSON for the same grader. It is **not** the upstream Irys harness.
- `legal-document-agent-irys-upstream` is a reference-only wrapper around upstream `irys run <task_dir>`. It is kept to document the boundary to the original harness, but it is not the focus of this eval pack and is not required for normal AgentV runs.

The same `evals/legal-document-agent.eval.yaml` stays canonical; targets are swappable by target name. The existing Codex target remains the documented default. Use `--target document-intelligence` or `--target legal-document-agent-stateful-swarm` for the provider-flexible skill workflow target. Treat the upstream Irys target as optional/reference-only.

## Initial task subset

The committed eval currently includes four representative tasks:

| AgentV test ID | Harvey LAB task | Focus |
|---|---|---|
| `corporate-ma-extract-change-of-control-provisions` | `corporate-ma/extract-change-of-control-provisions` | M&A contract extraction and risk analysis |
| `litigation-dispute-resolution-compare-document-production-against-discovery-requests` | `litigation-dispute-resolution/compare-document-production-against-discovery-requests` | Discovery production gap analysis |
| `data-privacy-cybersecurity-assess-breach-notification-obligations-across-affected-jurisdictions` | `data-privacy-cybersecurity/assess-breach-notification-obligations-across-affected-jurisdictions` | Multi-jurisdiction privacy incident response |
| `banking-finance-compare-credit-agreement-against-term-sheet` | `banking-finance/compare-credit-agreement-against-term-sheet` | Financing-document comparison |

The subset is intentionally conservative. It is meant to validate AgentV project shape, artifact safety, and Dashboard registration before expanding toward broader LAB coverage.

## Swappable AgentV targets

AgentV can compare the existing Codex/AgentV path and the provider-flexible document-intelligence skill workflow without changing eval YAML. The optional upstream Irys wrapper is listed only as a reference boundary:

| Target | What runs | Output AgentV grades | Harness artifacts |
|---|---|---|---|
| `legal-document-agent` | AgentV `codex` provider in the AgentV workspace | Markdown answer generated by the coding agent | AgentV run artifacts and Codex logs |
| `legal-document-agent-stateful-swarm` | AgentV `cli` provider wrapper around `scripts/run-stateful-swarm-agentv-target.ts` and `skills/document-intelligence/SKILL.md` | Markdown synthesized from staged document-intelligence prompts over extracted DOCX/XLSX/PPTX/EML/plaintext sources | `workflow-skill.md`, `document-inventory.json`, `document-excerpts.md`, `blackboard.json`, `state.json`, `final-answer.md` under `.agentv/harness-artifacts/stateful-swarm/` |
| `document-intelligence` | Alias for `legal-document-agent-stateful-swarm` | Same as above | Same as above |
| `stateful-swarm` | Alias for `legal-document-agent-stateful-swarm` | Same as above | Same as above |
| `legal-document-agent-irys-upstream` | Reference-only AgentV `cli` wrapper around upstream `irys run <task_dir>` | Text extracted from upstream native deliverables | Upstream output files, `metrics.json`, `status.json`, `swarm/*`, optional `scores.json` under `.agentv/harness-artifacts/irys-upstream/` |
| `irys-stateful-swarms-upstream` | Alias for `legal-document-agent-irys-upstream` | Same as upstream wrapper | Same as upstream wrapper |

The document-intelligence target exists because the product goal here is not to reproduce a bespoke upstream harness; it is to express reusable target-agent behavior as a skill workflow and evaluate it with AgentV. The skill borrows useful Irys/stateful-swarms patterns—staged work plus persisted state/provenance—while staying provider-flexible and AgentV-native. The exact upstream wrapper remains reference-only and out of scope for local deterministic verification.

## Prerequisites

Install AgentV separately.

For the default `legal-document-agent` target, configure a Codex-style coding agent plus a grader:

```bash
AGENT_TARGET=legal-document-agent
LEGAL_DOCUMENT_EVALS_ROOT=/absolute/path/to/legal-document-intelligence-evals
CODEX_EXECUTABLE=codex-eng
CODEX_MODEL=gpt-5.5
CODEX_REASONING_EFFORT=low
CODEX_LOG_DIR=.agentv/logs/codex
GRADER_TARGET=openai-grader
OPENAI_API_KEY=<local-secret>
OPENAI_MODEL=gpt-5.5
```

Create local env for this project:

```bash
cp .env.example .env
```

Fill in only local values in `.env`. Do not commit `.env`, resolved provider endpoints, API keys, result-repo tokens, or generated run artifacts.

`.agentv/targets.yaml` routes the shared `grader` alias through `GRADER_TARGET`, so set `GRADER_TARGET=openai-grader` or `GRADER_TARGET=azure-grader` before raw `agentv eval` commands. Package scripts default it to `openai-grader` when unset.

For the primary document-intelligence skill workflow target, configure:

```bash
AGENT_TARGET=legal-document-agent-stateful-swarm
LEGAL_DOCUMENT_EVALS_ROOT=/absolute/path/to/legal-document-intelligence-evals
DOCUMENT_INTELLIGENCE_SKILL_PATH=skills/document-intelligence/SKILL.md

# Live mode: OpenAI-compatible chat-completions endpoint.
OPENAI_API_KEY=<local-secret>
OPENAI_MODEL=gpt-5.5
# OPENAI_BASE_URL=https://your-compatible-endpoint/v1

# Offline wrapper-contract checks only; does not call a model.
STATEFUL_SWARM_MOCK=true

# Default is sized to include the current canonical Harvey subset in full.
# If lowered for smaller-context models, each source document is still represented.
STATEFUL_SWARM_MAX_DOC_CHARS=500000
```

For the optional reference-only upstream Irys wrapper, configure separately only if you explicitly want to compare against the original upstream harness:

```bash
AGENT_TARGET=legal-document-agent-irys-upstream
LEGAL_DOCUMENT_EVALS_ROOT=/absolute/path/to/legal-document-intelligence-evals
IRYS_STATEFUL_SWARMS_REPO_PATH=/absolute/path/to/irys-stateful-swarms
# or IRYS_EXECUTABLE=irys

# Current inspected upstream `irys run` uses src.providers.gemini.GeminiCaller.
GEMINI_API_KEY=<local-secret>
# or GOOGLE_API_KEY / GEMINI_API_KEYS
```

The upstream Irys preflight checks for variable names and local paths only. It must not print resolved secret values. `OPENAI_API_KEY` does not satisfy the upstream wrapper because the inspected upstream `irys run` path does not route through an OpenAI provider. This repo intentionally does not fork or shim upstream Irys provider behavior.

## Run

Preflight local provider configuration:

```bash
bun run setup
```

Preflight the document-intelligence/stateful-swarm target:

```bash
STATEFUL_SWARM_MOCK=true bun run setup:stateful-swarm
```

Preflight the optional upstream Irys wrapper:

```bash
bun run setup:irys-upstream
```

Validate the eval file:

```bash
bun run validate
```

Run a no-secrets dry run of one test through the Codex target:

```bash
agentv eval evals/legal-document-agent.eval.yaml \
  --targets .agentv/targets.yaml \
  --target legal-document-agent \
  --test-id corporate-ma-extract-change-of-control-provisions \
  --dry-run \
  --threshold 0
```

Run the same canonical eval through the document-intelligence skill workflow target:

```bash
agentv eval evals/legal-document-agent.eval.yaml \
  --targets .agentv/targets.yaml \
  --target document-intelligence \
  --test-id corporate-ma-extract-change-of-control-provisions
```

Package-script dry-run equivalents:

```bash
bun run eval:dry
bun run eval:stateful-swarm:dry
bun run eval:document-intelligence:dry
```

Run deterministic no-secrets wrapper contract checks:

```bash
STATEFUL_SWARM_MOCK=true bun run check:document-intelligence-contract
```

Document-intelligence/stateful-swarm artifacts are written under `.agentv/harness-artifacts/stateful-swarm/<agentv-run-timestamp>/<test-id>/...` by default. The target persists the exact workflow text used for the run as `workflow-skill.md` next to `blackboard.json`, `state.json`, `document-inventory.json`, `document-excerpts.md`, and `final-answer.md`. Upstream Irys artifacts are written under `.agentv/harness-artifacts/irys-upstream/`. Those artifacts are gitignored and may contain absolute local paths or provider debug output, so scan them before copying into any public results repo.

During AgentV repository development, prefer the source CLI from an AgentV checkout:

```bash
bun /path/to/agentv/apps/cli/src/cli.ts eval \
  /path/to/legal-document-intelligence-evals/evals/legal-document-agent.eval.yaml \
  --targets /path/to/legal-document-intelligence-evals/.agentv/targets.yaml \
  --target document-intelligence \
  --test-id corporate-ma-extract-change-of-control-provisions \
  --dry-run \
  --threshold 0
```

## Regenerate from Harvey LAB

Clone and pin Harvey LAB only when regenerating the eval YAML:

```bash
git clone https://github.com/harveyai/harvey-labs.git ../harvey-labs
git -C ../harvey-labs checkout 38936c4f07aa20c84b79abff7b4ad82d1f5902a9
HARVEY_LABS_REPO_PATH=../harvey-labs bun run generate
```

Use `--task <practice/task>` to add or replace task selections for local experiments:

```bash
HARVEY_LABS_REPO_PATH=../harvey-labs \
  bun run scripts/generate-eval-from-harvey.ts \
  --task corporate-ma/extract-change-of-control-provisions \
  --out evals/legal-document-agent.eval.yaml
```

Review generated YAML before committing. Keep expansions focused and avoid copying Harvey source documents into this repo; the eval workspace clones the pinned source repo instead.

## Results repository

Public-safe result artifacts belong in the separate repository:

```yaml
results:
  mode: github
  repo: EntityProcess/legal-document-intelligence-evals-results
  path: /path/to/legal-document-intelligence-evals-results
  auto_push: false
  branch_prefix: eval-results
```

The committed project-local `.agentv/config.yaml` intentionally omits `results.path` because that path is machine-local. Register the project in `$AGENTV_HOME/config.yaml` for Dashboard with the local path above.

Do not publish live results until artifacts have been scanned for API keys, provider endpoints, private filesystem paths, and confidential source data. Keep `auto_push: false` unless a human has approved the publication path.

## Comparing swappable AgentV targets

### In AgentV

Use the same eval file and switch only the target name. The normal comparison path is Codex-style agent target vs. the AgentV-native document-intelligence skill workflow:

```bash
agentv eval evals/legal-document-agent.eval.yaml \
  --targets .agentv/targets.yaml \
  --target legal-document-agent \
  --test-id corporate-ma-extract-change-of-control-provisions

agentv eval evals/legal-document-agent.eval.yaml \
  --targets .agentv/targets.yaml \
  --target document-intelligence \
  --test-id corporate-ma-extract-change-of-control-provisions
```

Then compare the AgentV run artifacts/results using the normal AgentV results and Dashboard workflows. This keeps the eval suite, grader prompt, result repository, and Dashboard registration portable while treating each harness as a target implementation.

The reference-only `legal-document-agent-irys-upstream` target can still be invoked with the same eval file when real Gemini/Google credentials and a local upstream Irys checkout are available, but upstream harness fidelity is not required for this eval pack to be useful.

### In Harvey LAB

Harvey LAB itself compares harnesses/models through native run IDs and static reports:

```bash
uv run python -m harness.run \
  --model anthropic/claude-sonnet-4-6 \
  --task corporate-ma/extract-change-of-control-provisions

uv run python -m evaluation.run_eval \
  --run-id corporate-ma/extract-change-of-control-provisions/claude-sonnet-4-6/<timestamp> \
  --task corporate-ma/extract-change-of-control-provisions \
  --judge-model claude-sonnet-4-6

uv run python -m evaluation.compare --task corporate-ma/extract-change-of-control-provisions
```

Native Harvey runs write `results/<run-id>/output/`, `metrics.json`, `transcript.jsonl`, `scores.json`, and `report.html`. Harvey's sweep utilities run model/task matrices and `evaluation.compare` builds dashboards across those native run IDs. Harvey LAB also has OpenAI model adapters in its native harness; adding a Harvey-native OpenAI-backed AgentV target would be a separate wrapper/target.

## Irys/stateful-swarms research context

Irys/stateful-swarms is useful research context for why legal/document-intelligence evals matter: it explores persistent blackboard state, source provenance, gap detection, and multi-worker synthesis over document corpora. Those ideas overlap with AgentV eval patterns for longitudinal state, cost, and quality.

This project includes an AgentV-native document-intelligence skill workflow inspired by Irys, plus a reference-only upstream Irys wrapper. The distinction matters:

- The document-intelligence skill workflow is provider-flexible and uses OpenAI-compatible env. It is meant for portable AgentV target comparisons and reusable target-agent behavior beyond legal.
- The upstream wrapper is fidelity-oriented reference material. It runs upstream `irys run` and preserves upstream artifacts, but it is Gemini/Google-backed in the inspected source and is not part of the local deterministic acceptance path.

Provider truth: upstream Irys lists OpenAI and Anthropic as optional/research-provider dependencies in project metadata, and its `ModelCaller` protocol would make a fork plausible. However, inspected `runner.py`, `cli.py`, `bench.py`, and `scoring.py` directly instantiate `GeminiCaller`, and only `src/providers/gemini.py` is present. Forking Irys to add `OpenAICaller` plus a provider factory would create a separate maintenance surface outside this eval repo. This PR deliberately does not pursue that; provider flexibility lives in the AgentV-native approximation.

Treat upstream benchmark numbers as project-reported unless independently rescored from artifacts.

## Secret and artifact boundary

Setup and target scripts print variable names and missing prerequisite guidance only. They must not print resolved secret values, private endpoints, Bitwarden output, or local result-repo tokens.

Before publishing any run artifact, scan it for:

- API keys and bearer tokens
- resolved provider endpoints
- private filesystem paths
- `.env` content
- model/provider debug logs that may include secrets
- non-public client or matter data

## AgentV composition note

This project deliberately uses AgentV primitives rather than new core features:

- `workspace.repos` clones the pinned Harvey LAB source into each eval workspace.
- `llm-grader` with rubric items adapts Harvey's criterion-level judge pattern.
- `skills/document-intelligence/SKILL.md` defines target-agent behavior as a reusable skill workflow: generic document intelligence first, legal specialization second.
- `cli` provider wraps the document-intelligence/stateful-swarm and upstream harness targets without adding Harvey/Irys concepts to AgentV core.
- A separate git results repo stores public-safe artifacts on its default `main` branch.

No plugin runtime hooks are included in this PR. Skills/templates plus existing AgentV workspace and target hooks are enough for the current need: the eval workspace supplies documents, the CLI target consumes the skill text and writes artifacts, and AgentV handles grading/results. Add plugin hooks later only if a concrete setup, preprocess, or cleanup need cannot be expressed with AgentV eval/target hooks.

Branch-specific git-native results targets are intentionally out of scope for this repo setup.
