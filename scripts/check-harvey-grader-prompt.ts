import { readFileSync } from 'node:fs';
import path from 'node:path';

const evalsRoot = process.env.LEGAL_DOCUMENT_EVALS_ROOT
  ? path.resolve(process.env.LEGAL_DOCUMENT_EVALS_ROOT)
  : process.cwd();

const promptPath = path.join(evalsRoot, 'prompts', 'harvey-lab-grader.md');
const evalPath = path.join(evalsRoot, 'evals', 'legal-document-agent.eval.yaml');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    return Object.hasOwn(vars, key) ? vars[key] : match;
  });
}

const promptTemplate = readFileSync(promptPath, 'utf8');
const evalYaml = readFileSync(evalPath, 'utf8');

assert(
  promptTemplate.includes('{{ rubrics_json }}'),
  'prompts/harvey-lab-grader.md must include {{ rubrics_json }} so custom LLM grading receives rubric IDs and outcomes.',
);
assert(
  evalYaml.includes('prompt: file://prompts/harvey-lab-grader.md'),
  'evals/legal-document-agent.eval.yaml must reference prompts/harvey-lab-grader.md.',
);
assert(
  evalYaml.includes('rubrics:') && evalYaml.includes('id: "C-001"'),
  'evals/legal-document-agent.eval.yaml must define Harvey rubric items for the custom grader.',
);

const rubricItems = [
  {
    id: 'REGRESSION-RUBRIC-001',
    operator: 'correctness',
    outcome: 'The rendered grader prompt must include rubric item IDs, operators, and outcomes.',
  },
];

const rendered = renderTemplate(promptTemplate, {
  input: 'Example Harvey LAB task input.',
  output: 'Example candidate answer.',
  file_changes: 'No file changes.',
  rubrics_json: JSON.stringify(rubricItems, null, 2),
});

assert(
  rendered.includes('Harvey LAB rubric items (JSON):'),
  'Rendered Harvey grader prompt must label the grader-only rubric JSON section.',
);
assert(
  rendered.includes('REGRESSION-RUBRIC-001') &&
    rendered.includes('"operator": "correctness"') &&
    rendered.includes('The rendered grader prompt must include rubric item IDs'),
  'Rendered Harvey grader prompt must include rubric item IDs, operators, and outcomes.',
);
assert(
  !rendered.includes('{{ rubrics_json }}'),
  'Rendered Harvey grader prompt must replace the {{ rubrics_json }} template variable.',
);

console.log('Harvey grader prompt rubric rendering check passed.');
