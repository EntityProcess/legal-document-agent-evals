#!/usr/bin/env bash
# Start a LiteLLM proxy that accepts Gemini generateContent requests from the
# upstream Irys Google GenAI client and forwards them to an OpenAI-compatible
# backend. The generated config references secrets via os.environ/* and does not
# write resolved API keys to disk.
set -euo pipefail

HOST="${IRYS_LITELLM_HOST:-127.0.0.1}"
PORT="${IRYS_LITELLM_PORT:-4000}"
CONFIG_PATH="${IRYS_LITELLM_CONFIG_PATH:-tmp/irys-litellm-proxy.config.yaml}"
MODEL_GROUP="${IRYS_LITELLM_MODEL_NAME:-agentv-openai-compatible}"
OPENAI_MODEL_VALUE="${OPENAI_MODEL:-}"

if [[ -z "$OPENAI_MODEL_VALUE" ]]; then
  echo "OPENAI_MODEL is required for the backend behind LiteLLM." >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required for the backend behind LiteLLM." >&2
  exit 1
fi

yaml_quote() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

aliases=()
add_alias() {
  local value="$1"
  [[ -z "$value" ]] && return
  for existing in "${aliases[@]}"; do
    [[ "$existing" == "$value" ]] && return
  done
  aliases+=("$value")
}

add_alias "${SWARM_WORKER_MODEL:-gemini-3.1-flash-lite}"
add_alias "${SWARM_SYNTHESIS_MODEL:-gemini-3.5-flash}"
add_alias "${SWARM_REVIEWER_MODEL:-gemini-3.5-flash}"
# Keep common upstream defaults addressable even if a caller omits model env.
add_alias "gemini-3.1-flash-lite"
add_alias "gemini-3.5-flash"

mkdir -p "$(dirname "$CONFIG_PATH")"
{
  echo "model_list:"
  echo "  - model_name: $(yaml_quote "$MODEL_GROUP")"
  echo "    litellm_params:"
  echo "      model: $(yaml_quote "openai/${OPENAI_MODEL_VALUE}")"
  echo "      api_key: os.environ/OPENAI_API_KEY"
  if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
    echo "      api_base: os.environ/OPENAI_BASE_URL"
  fi
  echo "router_settings:"
  echo "  model_group_alias:"
  for alias in "${aliases[@]}"; do
    echo "    $(yaml_quote "$alias"): $(yaml_quote "$MODEL_GROUP")"
  done
} > "$CONFIG_PATH"

cat <<EOF
LiteLLM config written to $CONFIG_PATH
Proxy URL for upstream Irys: http://$HOST:$PORT
Use in this repo:
  IRYS_USE_LITELLM_PROXY=true IRYS_LITELLM_BASE_URL=http://$HOST:$PORT bun run setup:irys-upstream-litellm
EOF

if [[ -n "${LITELLM_EXECUTABLE:-}" ]]; then
  exec "$LITELLM_EXECUTABLE" --config "$CONFIG_PATH" --host "$HOST" --port "$PORT"
fi

exec uvx --from 'litellm[proxy]' litellm --config "$CONFIG_PATH" --host "$HOST" --port "$PORT"
