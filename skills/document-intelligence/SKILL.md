---
name: document-intelligence
description: Evidence-grounded workflow for analyzing document sets, extracting source-backed findings, comparing documents, tracking open questions, and producing verified answers. Use for document intelligence tasks in any domain, including legal-document analysis, contract review, diligence, discovery, privacy incident response, policy review, and finance/term-sheet comparison.
---

# Document Intelligence

Use this skill to turn a folder of source documents into a grounded work product. It is generic first: the same workflow applies to legal, finance, operations, compliance, research, or policy documents. Apply the legal specialization only when the task is legal or contract-related.

## Boundary with AgentV

- Treat AgentV as the eval harness: it supplies the task, workspace, target selection, traces, artifacts, and graders.
- Treat this skill as target-agent behavior: it tells the agent how to read, reason, preserve evidence, and answer.
- Do not inspect or optimize against grader prompts, rubric criteria, hidden expected answers, or scoring logic. Use only the user task, public source documents, and ordinary domain knowledge.

## Generic document-intelligence workflow

1. **Orient and plan before reading deeply**
   - Restate the requested deliverable and scope.
   - Inventory source documents by filename/type before drawing conclusions.
   - Create a short reading plan: which documents are primary, which are supporting, and what questions must be answered.

2. **Build a lightweight blackboard**
   Track working state in concise notes or JSON-like entries:
   - `sources`: document filename, type, date if apparent, and role in the task.
   - `entities`: normalized people, organizations, products, agreements, dates, amounts, locations, and defined terms.
   - `evidence`: source filename plus section/page/heading/row/email header where feasible; include short quotes only when helpful.
   - `signals`: facts that matter, anomalies, conflicts, missing documents, assumptions, and confidence.
   - `open_questions`: unresolved issues and what source would close each gap.

3. **Extract evidence with source custody**
   - Prefer source-grounded summaries over unsupported conclusions.
   - Preserve provenance for every material finding using filenames and section/table/email references.
   - Separate direct evidence from inference. Label uncertainty plainly.
   - Normalize aliases and repeated entities so the final answer does not fragment the same party/item under multiple names.

4. **Compare and reconcile documents**
   - For comparison tasks, align the same concepts across documents before judging differences.
   - Identify missing, conflicting, narrowed, broadened, delayed, accelerated, or economically changed terms.
   - Track whether a difference is material, directional, and adverse/beneficial to the relevant stakeholder.

5. **Close gaps before synthesis**
   - Review open questions and signals before writing the final answer.
   - If a required fact is unavailable, say what is missing instead of inventing it.
   - Re-check the highest-impact claims against their source documents.

6. **Synthesize with verification**
   - Structure the final answer exactly around the requested deliverable.
   - Include source citations where feasible: filename plus section/table/email/date/party.
   - Include recommendations or action items only when asked or directly implied by the task.
   - Final pass: verify all requested outputs are present, material sources were considered, citations support claims, and no grader/criteria text leaked into the answer.

## Legal specialization

Apply this section only for legal/document-intelligence tasks.

- Track parties, affiliates, counterparties, roles, governing documents, agreement names, execution/effective dates, and defined terms.
- Extract clauses, obligations, covenants, consent rights, termination rights, notice periods, cure periods, exceptions, thresholds, dollar amounts, dates, and survival/renewal terms.
- For risk analysis, tie each risk rating to concrete legal/contract facts and practical exposure; avoid generic legal conclusions unsupported by sources.
- For term-sheet, credit agreement, redline, or document comparison work, present side-by-side differences and identify which party the deviation favors.
- For litigation/discovery work, map requests to productions, privilege entries, custodians, time periods, topics, and missing categories.
- For privacy/cybersecurity work, map jurisdictions, data subjects, data types, deadlines, regulators, contractual notice duties, insurance exclusions, and factual uncertainty.
- Respect privilege/confidentiality boundaries. Do not use private client data, paid legal research systems, private endpoints, or secrets unless explicitly provided for the task.
- Do not provide legal advice beyond the requested benchmark-style analysis; frame conclusions as document-based analysis.

## Output expectations

- Use Markdown unless the task explicitly requires another format.
- Create one top-level section per requested deliverable when the source task names deliverable files.
- Prefer tables for extraction/comparison matrices and bullets for action items.
- Use a final verification note only if it helps the user; do not expose hidden evaluator or rubric reasoning.
