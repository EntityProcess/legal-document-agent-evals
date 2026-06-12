# legal-document-agent-evals

AgentV eval project for public legal/document-intelligence agents.

This repository is an AgentV adaptation of a small, representative subset of [Harvey LAB](https://github.com/harveyai/harvey-labs), the Legal Agent Benchmark. It is broad enough for Harvey LAB-style legal/document intelligence (diligence, litigation discovery, privacy incident response, financing document comparison) without implying coverage of every possible legal-agent task.

It is **not** tied to Irys and is **not** a fork of Harvey LAB. Harvey LAB remains the source dataset and native harness; this repo provides AgentV eval definitions, targets, prompts, and regeneration scripts.

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

This AgentV adaptation keeps the source task instructions, deliverable names, tags, and rubric criteria. It materializes the pinned Harvey LAB repo into the AgentV workspace and asks the target agent to return Markdown sections for the requested deliverables. The grader evaluates substance against Harvey's criteria rather than requiring DOCX/XLSX output.

## Initial task subset

The committed eval currently includes four representative tasks:

| AgentV test ID | Harvey LAB task | Focus |
|---|---|---|
| `corporate-ma-extract-change-of-control-provisions` | `corporate-ma/extract-change-of-control-provisions` | M&A contract extraction and risk analysis |
| `litigation-dispute-resolution-compare-document-production-against-discovery-requests` | `litigation-dispute-resolution/compare-document-production-against-discovery-requests` | Discovery production gap analysis |
| `data-privacy-cybersecurity-assess-breach-notification-obligations-across-affected-jurisdictions` | `data-privacy-cybersecurity/assess-breach-notification-obligations-across-affected-jurisdictions` | Multi-jurisdiction privacy incident response |
| `banking-finance-compare-credit-agreement-against-term-sheet` | `banking-finance/compare-credit-agreement-against-term-sheet` | Financing-document comparison |

The subset is intentionally conservative. It is meant to validate AgentV project shape, artifact safety, and Dashboard registration before expanding toward broader LAB coverage.

## Prerequisites

Install AgentV separately.

For the default `legal-document-agent` target, configure a Codex-style coding agent plus a grader:

```bash
AGENT_TARGET=legal-document-agent
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

## Run

Preflight local provider configuration:

```bash
bun run setup
```

Validate the eval file:

```bash
agentv validate evals/legal-document-agent.eval.yaml
```

Run a no-secrets dry run of one test:

```bash
agentv eval evals/legal-document-agent.eval.yaml \
  --targets .agentv/targets.yaml \
  --target legal-document-agent \
  --test-id corporate-ma-extract-change-of-control-provisions \
  --dry-run
```

Run a live eval only after reviewing public-artifact safety and configuring a real target/grader:

```bash
agentv eval evals/legal-document-agent.eval.yaml \
  --targets .agentv/targets.yaml \
  --target legal-document-agent
```

During AgentV repository development, prefer the source CLI from an AgentV checkout:

```bash
bun /path/to/agentv/apps/cli/src/cli.ts eval \
  /path/to/legal-document-agent-evals/evals/legal-document-agent.eval.yaml \
  --targets /path/to/legal-document-agent-evals/.agentv/targets.yaml \
  --target legal-document-agent \
  --test-id corporate-ma-extract-change-of-control-provisions \
  --dry-run
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
  repo: EntityProcess/legal-document-agent-evals-results
  path: /path/to/legal-document-agent-evals-results
  auto_push: false
  branch_prefix: eval-results
```

The committed project-local `.agentv/config.yaml` intentionally omits `results.path` because that path is machine-local. Register the project in `$AGENTV_HOME/config.yaml` for Dashboard with the local path above.

Do not publish live results until artifacts have been scanned for API keys, provider endpoints, private filesystem paths, and confidential source data. Keep `auto_push: false` unless a human has approved the publication path.

## Irys/stateful-swarms research context

Irys/stateful-swarms is useful research context for why legal/document-intelligence evals matter: it explores persistent blackboard state, source provenance, gap detection, and multi-worker synthesis over document corpora. Those ideas overlap with future AgentV eval patterns for longitudinal state, cost, and quality.

This project uses Irys/stateful-swarms only as motivation and comparison. It is not named after Irys, does not depend on Irys code or services, and starts from Harvey LAB's public benchmark tasks.

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
- A separate git results repo stores public-safe artifacts on its default `main` branch.

Branch-specific git-native results targets are intentionally out of scope for this repo setup.
