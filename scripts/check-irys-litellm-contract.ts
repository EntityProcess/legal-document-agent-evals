#!/usr/bin/env bun
/**
 * Deterministic compatibility checks for the LiteLLM-backed upstream Irys path.
 *
 * Default mode does not require live model credentials or a running LiteLLM
 * process. It proves that the unmodified upstream Irys GeminiCaller honors a
 * Gemini-compatible base URL override and emits the generateContent request
 * shape that LiteLLM's native Gemini router accepts.
 *
 * Optional mode (`--with-litellm-proxy` or CHECK_LITELLM_PROXY=true) starts a
 * local fake OpenAI-compatible backend plus a real LiteLLM proxy and proves a
 * Gemini generateContent request is translated into /v1/chat/completions.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_WORKER_MODEL = 'gemini-3.1-flash-lite';

type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: string;
};

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function irysRepoPath(): string {
  const candidates = [
    env('IRYS_STATEFUL_SWARMS_REPO_PATH') ? path.resolve(env('IRYS_STATEFUL_SWARMS_REPO_PATH')!) : undefined,
    path.resolve(repoRoot(), '..', 'irys-stateful-swarms'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'pyproject.toml'))) return candidate;
  }

  throw new Error(
    'IRYS_STATEFUL_SWARMS_REPO_PATH must point at a local dl1683/irys-stateful-swarms checkout for this contract check.',
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function shouldRunLiteLlmProxyCheck(): boolean {
  return process.argv.includes('--with-litellm-proxy') || ['1', 'true', 'yes'].includes((env('CHECK_LITELLM_PROXY') ?? '').toLowerCase());
}

function runProcess(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function checkUpstreamGeminiBaseUrlContract(): Promise<void> {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = await request.text();
      requests.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: '{"litellm_contract_ok":true}' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [],
          },
        ],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 4,
          totalTokenCount: 7,
        },
      });
    },
  });

  try {
    const irysRepo = irysRepoPath();
    const result = await runProcess(
      env('UV_EXECUTABLE') ?? 'uv',
      [
        'run',
        '--project',
        irysRepo,
        'python',
        '-c',
        String.raw`
from src.providers.gemini import GeminiCaller

result = GeminiCaller(model="gemini-3.1-flash-lite").complete(
    "route this through the Gemini-compatible proxy",
    max_tokens=16,
)
print(result.text)
assert "litellm_contract_ok" in result.text
`,
      ],
      {
        cwd: irysRepo,
        env: {
          ...process.env,
          GEMINI_API_KEY: 'sk-agentv-local-litellm',
          GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${server.port}`,
          GEMINI_TIMEOUT_MS: '5000',
        },
      },
    );

    if (result.status !== 0) {
      throw new Error(`Upstream GeminiCaller base URL check failed:\n${result.stderr || result.stdout}`);
    }

    assert(requests.length === 1, `Expected one Gemini request, saw ${requests.length}.`);
    const [request] = requests;
    assert(request.method === 'POST', `Expected POST request, saw ${request.method}.`);
    assert(
      request.path.startsWith('/v1beta/models/gemini-3.1-flash-lite:generateContent'),
      `Unexpected Gemini route: ${request.path}`,
    );
    const body = JSON.parse(request.body) as Record<string, unknown>;
    assert(Array.isArray(body.contents), 'Gemini request should include contents[].');
    assert(
      JSON.stringify(body).includes('responseMimeType'),
      'Gemini request should preserve generationConfig.responseMimeType for json_mode calls.',
    );
  } finally {
    server.stop(true);
  }
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') });
  const port = server.port;
  server.stop(true);
  return port;
}

function yamlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function checkRealLiteLlmProxyTranslation(): Promise<void> {
  const openAiRequests: RecordedRequest[] = [];
  const fakeOpenAi = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = await request.text();
      openAiRequests.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
      if (url.pathname.endsWith('/chat/completions')) {
        return Response.json({
          id: 'chatcmpl-agentv-litellm-contract',
          object: 'chat.completion',
          created: 0,
          model: 'mock-openai',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"litellm_proxy_ok":true}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        });
      }
      return Response.json({ object: 'list', data: [{ id: 'mock-openai', object: 'model' }] });
    },
  });

  const tmpRoot = path.join(repoRoot(), 'tmp/irys-litellm-contract');
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
  const proxyPort = await freePort();
  const configPath = path.join(tmpRoot, 'litellm.config.yaml');
  writeFileSync(
    configPath,
    [
      'model_list:',
      '  - model_name: agentv-openai-compatible',
      '    litellm_params:',
      '      model: openai/mock-openai',
      `      api_base: http://127.0.0.1:${fakeOpenAi.port}/v1`,
      '      api_key: sk-fake',
      'router_settings:',
      '  model_group_alias:',
      `    ${yamlQuote(DEFAULT_WORKER_MODEL)}: agentv-openai-compatible`,
      '    gemini-3.5-flash: agentv-openai-compatible',
      '',
    ].join('\n'),
  );

  const useExecutable = env('LITELLM_EXECUTABLE');
  const proxy = useExecutable
    ? spawn(useExecutable, ['--config', configPath, '--host', '127.0.0.1', '--port', String(proxyPort)], {
        env: process.env,
      })
    : spawn(env('UVX_EXECUTABLE') ?? 'uvx', ['--from', 'litellm[proxy]', 'litellm', '--config', configPath, '--host', '127.0.0.1', '--port', String(proxyPort)], {
        env: process.env,
      });

  let proxyLog = '';
  proxy.stdout.on('data', (chunk) => {
    proxyLog += chunk.toString();
  });
  proxy.stderr.on('data', (chunk) => {
    proxyLog += chunk.toString();
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (proxy.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${proxyPort}/health/liveliness`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // keep waiting
      }
      await sleep(500);
    }
    assert(ready, `LiteLLM proxy did not become ready. Log:\n${proxyLog.slice(-4000)}`);

    const response = await fetch(
      `http://127.0.0.1:${proxyPort}/v1beta/models/${DEFAULT_WORKER_MODEL}:generateContent?key=sk-anything`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'hello' }], role: 'user' }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    );
    const body = await response.text();
    assert(response.ok, `LiteLLM Gemini route failed (${response.status}): ${body}\n${proxyLog.slice(-4000)}`);
    assert(body.includes('litellm_proxy_ok'), `Unexpected LiteLLM response: ${body}`);
    assert(openAiRequests.some((request) => request.path === '/v1/chat/completions'), 'Fake OpenAI backend did not receive /v1/chat/completions.');
  } finally {
    proxy.kill('SIGTERM');
    fakeOpenAi.stop(true);
  }
}

async function main(): Promise<void> {
  await checkUpstreamGeminiBaseUrlContract();
  if (shouldRunLiteLlmProxyCheck()) {
    await checkRealLiteLlmProxyTranslation();
    console.log('Irys/LiteLLM contract checks passed, including real LiteLLM proxy translation.');
    return;
  }
  console.log('Irys/LiteLLM contract check passed (upstream Gemini base URL route).');
  console.log('Set CHECK_LITELLM_PROXY=true to also run a local LiteLLM + fake OpenAI translation check.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
