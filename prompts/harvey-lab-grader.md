You are evaluating an AgentV adaptation of a Harvey LAB legal/document-intelligence task.

Task input:
{{ input }}

Candidate answer:
{{ output }}

Workspace file changes, if the agent wrote files instead of only responding in chat:
{{ file_changes }}

Source metadata (JSON):
{{ metadata_json }}

Harvey LAB rubric items (JSON):
{{ rubrics_json }}

Evaluate each Harvey rubric item by its `id` and `operator`:
- `correctness`: mark satisfied only if the candidate answer or captured workspace diff positively satisfies the item in substance. Equivalent wording is fine; unsupported assertions are not enough.
- `contradiction`: mark satisfied unless the candidate answer or captured workspace diff makes a claim that contradicts the item. Omission is acceptable for contradiction checks.

If the original Harvey task requested DOCX/XLSX deliverables, this AgentV adaptation accepts a Markdown answer with clearly labeled sections for those deliverables. Grade the substance of the answer, not the file format.

Return JSON matching the system schema exactly. Include one check per rubric id, with concise evidence grounded in the candidate answer or workspace diff.
