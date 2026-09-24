/**
 * 调用大模型做分析。
 *
 * 沿用你们服务器上已有的配置（workspace/.env 里那套）：
 *   OPENROUTER_API_KEY + OPENROUTER_BASE_URL + LLM_MODEL
 * 没配 OpenRouter 时退回 Anthropic 官方接口（ANTHROPIC_API_KEY + AI_MODEL）。
 *
 * Why 裸 fetch：这个服务零依赖跑在容器里，为一个 POST 引 SDK 不划算。
 * 两家都是 HTTP+JSON，差别只在路径、鉴权头和响应结构，这里收敛成一个函数。
 */

// 网关对大 prompt 很慢，180 s 在线上被打断过；10 分钟兜底，可用 AI_TIMEOUT_MS 调。
function positive(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function limits(env) {
  return {
    maxTokens: positive(env.AI_MAX_TOKENS, 8000),
    timeoutMs: positive(env.AI_TIMEOUT_MS, 600000)
  }
}

export function llmConfig(env = process.env) {
  // 优先级最高：自建中转站。同一套 OpenAI 兼容协议，只是换个地址和 key，
  // 所以从 OpenRouter 切到自己的站台只改环境变量，不动代码。
  if (env.LLM_BASE_URL && env.LLM_API_KEY) {
    return {
      kind: 'openai',
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL,
      model: env.LLM_MODEL || 'claude-opus-4-7',
      ...limits(env)
    }
  }
  if (env.OPENROUTER_API_KEY) {
    return {
      kind: 'openai',
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      model: env.LLM_MODEL || 'claude-opus-4-7',
      ...limits(env)
    }
  }
  return {
    kind: 'anthropic',
    apiKey: env.ANTHROPIC_API_KEY || '',
    baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages',
    model: env.AI_MODEL || 'claude-sonnet-5',
    ...limits(env)
  }
}

export function llmReady(env = process.env) {
  return Boolean(llmConfig(env).apiKey)
}

async function callOpenAiCompatible({ system, prompt, config, signal }) {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    })
  })
  if (!response.ok) {
    throw new Error(
      `模型返回 ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`
    )
  }
  const data = await response.json()
  return {
    text: String(data.choices?.[0]?.message?.content ?? '').trim(),
    finishReason: data.choices?.[0]?.finish_reason ?? null,
    model: data.model ?? config.model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0
  }
}

async function callAnthropic({ system, prompt, config, signal }) {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!response.ok) {
    throw new Error(
      `模型返回 ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`
    )
  }
  const data = await response.json()
  return {
    text: (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim(),
    finishReason: data.stop_reason ?? null,
    model: data.model ?? config.model,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0
  }
}

/**
 * 单轮问答。返回正文、用量和 finishReason —— "省 token" 必须先能看见花了多少，
 * 截断（length / max_tokens）也要让调用方看得见。
 */
export async function askModel({ system, prompt, env = process.env, maxTokens, timeoutMs }) {
  const base = llmConfig(env)
  const config = { ...base, maxTokens: maxTokens ?? base.maxTokens }
  if (!config.apiKey) {
    throw new Error('没有可用的模型凭证（OPENROUTER_API_KEY / ANTHROPIC_API_KEY 都为空）')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? config.timeoutMs)
  try {
    const args = { system, prompt, config, signal: controller.signal }
    return await (config.kind === 'openai' ? callOpenAiCompatible(args) : callAnthropic(args))
  } finally {
    clearTimeout(timer)
  }
}
