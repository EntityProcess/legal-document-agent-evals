# Legal document AgentV baseline results

This report is the public baseline for the legal/document-intelligence eval pack in this repository. It is written for readers who want to understand what was measured without reading raw JSONL first.

The short version: **AgentV is the eval framework**. The legal/document-specific work lives in this repo as eval YAML, skills, target wrappers, prompts, and graders. AgentV supplies the reusable harness: target switching, workspace setup, traces/results, grading, and public result artifacts.

## What was evaluated

The baseline run evaluated an AgentV-native document-intelligence target on four representative tasks adapted from [Harvey LAB](https://github.com/harveyai/harvey-labs):

| Area | AgentV test ID | What the agent had to do | Email source? |
| --- | --- | --- | --- |
| Corporate M&A | `corporate-ma-extract-change-of-control-provisions` | Extract and assess change-of-control provisions from acquisition-target contracts. | No |
| Litigation/discovery | `litigation-dispute-resolution-compare-document-production-against-discovery-requests` | Compare document production, privilege log, and discovery responses against discovery requests. | Yes — `documents/meet-confer-emails.eml` |
| Data privacy/cybersecurity | `data-privacy-cybersecurity-assess-breach-notification-obligations-across-affected-jurisdictions` | Assess breach-notification obligations across federal and state requirements. | Yes — `documents/client-notification-email-thread.eml` |
| Banking/finance | `banking-finance-compare-credit-agreement-against-term-sheet` | Compare a draft credit agreement against an executed term sheet and flag borrower-impacting deviations. | Yes — `documents/lender-counsel-transmittal.eml` |

The three `.eml` cases are important because they verify that the target is not limited to DOCX/PDF-style legal documents. The live target extracted email headers and body text and made those sources available to the staged document-intelligence workflow before synthesis.

## Target, model, and grading setup

| Field | Baseline value |
| --- | --- |
| Eval framework | AgentV |
| Eval file | `evals/legal-document-agent.eval.yaml` |
| Target alias used | `document-intelligence` |
| Concrete target | `legal-document-agent-stateful-swarm` |
| Target behavior | AgentV-native document-intelligence skill workflow using staged plan/extract/analyze/synthesize steps and a lightweight blackboard/state artifact. |
| Model used for target/grading run | `gpt-5.4-mini` through an OpenAI-compatible chat-completions provider |
| Grader | AgentV `llm-grader` using the Harvey rubric items adapted into `prompts/harvey-lab-grader.md` |
| Run name | `live-document-intelligence-2026-06-13T22-50-31Z` |

The target is **Irys-inspired**, not the upstream Irys harness. It preserves useful stateful-swarm ideas—plan first, staged extraction, evidence/source notes, open questions, a persisted blackboard, final verification—while keeping AgentV as the eval harness and the provider surface swappable.

## Baseline scores

Scores are rubric pass rates: passed Harvey/AgentV rubric checks divided by total rubric checks for that case. A score of 100% would mean every rubric item was satisfied according to the AgentV grader. The baseline run completed all four cases without target execution errors.

| Case | Score | Rubric checks passed | Execution status | Email source? |
| --- | ---: | ---: | --- | --- |
| `corporate-ma-extract-change-of-control-provisions` | 43.6% | 24 / 55 | `ok` | No |
| `litigation-dispute-resolution-compare-document-production-against-discovery-requests` | 23.9% | 11 / 46 | `ok` | Yes |
| `data-privacy-cybersecurity-assess-breach-notification-obligations-across-affected-jurisdictions` | 43.5% | 20 / 46 | `ok` | Yes |
| `banking-finance-compare-credit-agreement-against-term-sheet` | 48.5% | 16 / 33 | `ok` | Yes |
| **Mean** | **40.0%** | — | **4 / 4 completed** | **3 / 4 include `.eml`** |

## How to read this baseline

This is a **green integration baseline**, not a claim that the model already performs legal work well.

What the run proves:

- AgentV can run the legal/document-intelligence eval pack end to end.
- The same AgentV eval file can target the document-intelligence workflow without a bespoke eval runner.
- The target can ingest mixed legal source materials, including `.eml` email files.
- AgentV captured per-case results, transcripts, grading outputs, and aggregate benchmark metadata.
- Public-safe results can be published separately from private provider logs and raw local harness artifacts.

What the run does **not** prove:

- It does not establish production-ready legal accuracy.
- It does not replace lawyer review or domain-expert validation.
- It does not claim parity with upstream Harvey LAB or upstream Irys native scoring.
- It does not make upstream Irys the acceptance path for this repo.
- It should not be treated as a merge gate based on the absolute score; the score is a baseline for later target/model/prompt comparisons.

## AgentV proof framing

This baseline is intended to demonstrate the product thesis:

> Stop building bespoke eval frameworks. Build portable eval packs on AgentV.

The division of responsibility is deliberate:

| Layer | Lives here? | Role |
| --- | --- | --- |
| AgentV framework | External dependency | Provides eval execution, target selection, workspaces, traces/results, grading, result validation, and publication-compatible artifacts. |
| Legal/document eval pack | This repository | Defines the adapted Harvey tasks, rubrics, prompts, target config, and reproducible setup checks. |
| Document-intelligence skill workflow | This repository | Encodes reusable behavior for document analysis: planning, ingestion, blackboard state, evidence citations, entity normalization, comparison, open questions, synthesis, and verification. |
| Provider/model choice | Environment/target config | Can be swapped through AgentV targets without rewriting the eval YAML. |

That means the legal specialization is portable. The benchmark can compare `legal-document-agent`, `document-intelligence`, future provider-backed targets, or reference wrappers by switching AgentV target names rather than forking the eval framework.

## Public result artifacts

The sanitized live run is published in the separate public results repository:

- Run summary: https://github.com/EntityProcess/legal-document-agent-evals-results/blob/8733eec09196b6ac2b68b9e1983966e085598e02/.agentv/results/runs/live-document-intelligence-2026-06-13T22-50-31Z/SUMMARY.md
- Raw AgentV result index: https://github.com/EntityProcess/legal-document-agent-evals-results/blob/8733eec09196b6ac2b68b9e1983966e085598e02/.agentv/results/runs/live-document-intelligence-2026-06-13T22-50-31Z/index.jsonl
- Aggregate benchmark metadata: https://github.com/EntityProcess/legal-document-agent-evals-results/blob/8733eec09196b6ac2b68b9e1983966e085598e02/.agentv/results/runs/live-document-intelligence-2026-06-13T22-50-31Z/benchmark.json
- Full published run tree: https://github.com/EntityProcess/legal-document-agent-evals-results/tree/8733eec09196b6ac2b68b9e1983966e085598e02/.agentv/results/runs/live-document-intelligence-2026-06-13T22-50-31Z

The published run intentionally excludes provider logs, local run logs, local environment files, OAuth files, and raw harness-artifact directories. The result copy was sanitized before publication so public readers can inspect AgentV-ready artifacts without exposing private provider configuration.

## Next comparisons this baseline enables

Useful next runs include:

1. Re-run the same eval with the default `legal-document-agent` Codex-style target.
2. Re-run `document-intelligence` with another model or provider.
3. Compare score deltas and per-rubric failures across targets.
4. Add more Harvey LAB tasks once artifact safety and result publication remain stable.

The key invariant should stay the same: keep `evals/legal-document-agent.eval.yaml` canonical and swap behavior at the AgentV target boundary.
