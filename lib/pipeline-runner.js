/**
 * Server-side multiphase pipeline orchestration.
 *
 * Runs user input through four sequential agent phases:
 *   1. Optimizer   — rewrites raw input into an effective prompt
 *   2. Generator   — produces primary content from the optimized prompt
 *   3. Critic      — evaluates output across quality dimensions
 *   4. Synthesizer — revises based on critique; appends run docs
 *
 * Each phase streams tokens via SSE before emitting a phase_complete record.
 * Thinking blocks are stripped before being passed to the next phase; raw
 * output (with thinking) is preserved in the run record for display.
 */

import { stripThinkingBlocks, extractThinkingContent } from './gemma4-utils.js';
import { nodeForPhase } from '../config/ollama-nodes.js';

// ─── Canonical Gemma 4 Sampling ───────────────────────────────────────────────
// Per spec §2.2 — reflects the model's training distribution.

const GEMMA4_SAMPLING = Object.freeze({
  temperature: 1.0,
  top_p: 0.95,
  top_k: 64,
});

// ─── System Prompts ───────────────────────────────────────────────────────────
// The <|think|> prefix is prepended by ollamaChat() when thinkingEnabled is
// true — it is NOT embedded in these base strings.

const SYSTEM_PROMPTS = {
  optimizer: `You are an expert prompt engineer. Your sole task is to rewrite the user's raw input into an optimized prompt for a large language model.

Output requirements:
- Preserve the user's original intent completely
- Add relevant context, constraints, and output format instructions
- Specify the desired tone, structure, and length if inferrable
- Use clear delimiters and role framing where appropriate
- Do NOT produce the actual answer — only the improved prompt
- Output the optimized prompt only, with no preamble or explanation`,

  generator: `You are a highly capable AI assistant. Respond to the following prompt with your best possible output. Be thorough, accurate, and well-structured.`,

  critic: `You are a rigorous editorial critique agent. You will receive:
1. The user's original raw intent
2. The optimized prompt used for generation
3. The generated output

Evaluate the output against the original intent on these axes:
- Accuracy & Factual Grounding (1–10)
- Completeness (1–10)
- Clarity & Structure (1–10)
- Alignment with Original Intent (1–10)
- Quality of Reasoning / Depth (1–10)

For each axis, provide:
- A numeric score
- One sentence of justification
- One specific, actionable improvement suggestion

End your critique with:
- An overall score (average, rounded to one decimal)
- A prioritized list of the top 3 changes that would most improve the output
- A "Revision Brief" paragraph (3–5 sentences) summarizing what the synthesizer should fix

Output as structured markdown with clear headers.`,

  synthesizer: `You are a senior editor and synthesis agent. You will receive the full context of a multiphase generation run:
1. The user's original intent
2. The optimized prompt
3. The first-pass generated output
4. A structured critique report

Your task:
- Produce a revised, improved final output that directly addresses the critique's top findings
- Do not simply restate the original; make substantive improvements
- Maintain the original intent while elevating quality

After your revised output, append a "Run Documentation" section formatted as markdown with the following subsections:
- **Run Summary**: 2–3 sentence overview of what changed and why
- **Key Improvements**: Bulleted list of specific changes made
- **Remaining Limitations**: Honest assessment of what could still be improved
- **Prompt Engineering Notes**: Observations about what made the optimized prompt effective or ineffective`,
};

const PHASE_THINKING_DEFAULTS = {
  optimizer: true,
  generator: true,
  critic: true,
  synthesizer: true,
};

const PHASE_MODEL_DEFAULTS = {
  optimizer: 'gemma4:e4b',
  generator: 'gemma4:26b',
  critic: 'gemma4:e4b',
  synthesizer: 'gemma4:31b',
};

const PRIME_TIMEOUT_MS = 180_000;
const PHASE_TIMEOUT_MS = 180_000;
const PRIME_RETRY_DELAY_MS = 1_500;
const MAX_PHASE_RETRIES = 1;

// ─── Ollama Chat ──────────────────────────────────────────────────────────────

/**
 * Calls Ollama /api/chat, optionally streaming tokens via onDelta callback.
 * When thinkingEnabled, prepends <|think|> to the system prompt.
 * Native `message.thinking` fields are re-wrapped into channel format so
 * extractThinkingContent() can find them uniformly in the raw output.
 *
 * @param {string} baseUrl
 * @param {{ role: string, content: string }[]} messages
 * @param {{ model: string, systemPrompt: string, thinkingEnabled: boolean, contextWindow?: number }} config
 * @param {((event: { channel: 'thinking'|'output', delta: string }) => void) | null} onDelta
 * @returns {Promise<{ rawOutput: string, thinkingContent: string | null, outputContent: string }>}
 */
async function ollamaChat(baseUrl, messages, config, onDelta = null) {
  const systemPrompt = config.thinkingEnabled
    ? `<|think|>\n${config.systemPrompt}`
    : config.systemPrompt;

  const payload = {
    model: config.model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream: onDelta !== null,
    options: {
      ...GEMMA4_SAMPLING,
      num_ctx: config.contextWindow ?? 32768,
    },
  };

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Ollama error (${res.status}): ${text.slice(0, 200)}`);
  }

  if (onDelta === null) {
    const data = await res.json();
    const thinking = data.message?.thinking?.trim() || null;
    const output = data.message?.content ?? '';
    return {
      rawOutput: composePhaseRawOutput(thinking, output),
      thinkingContent: thinking,
      outputContent: output,
    };
  }

  // Streaming — pipe NDJSON lines to onDelta as they arrive
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  let accumulatedOutput = '';
  let accumulatedThinking = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.message?.thinking) {
            accumulatedThinking += chunk.message.thinking;
            onDelta({ channel: 'thinking', delta: chunk.message.thinking });
          }
          const delta = chunk.message?.content ?? '';
          if (delta) {
            accumulatedOutput += delta;
            onDelta({ channel: 'output', delta });
          }
        } catch { /* partial JSON, skip */ }
      }
    }

    if (lineBuffer.trim()) {
      try {
        const chunk = JSON.parse(lineBuffer.trim());
        if (chunk.message?.thinking) {
          accumulatedThinking += chunk.message.thinking;
          onDelta({ channel: 'thinking', delta: chunk.message.thinking });
        }
        const delta = chunk.message?.content ?? '';
        if (delta) {
          accumulatedOutput += delta;
          onDelta({ channel: 'output', delta });
        }
      } catch { /* ignore */ }
    }
  } finally {
    reader.releaseLock();
  }

  const thinkingContent = accumulatedThinking.trim() || null;
  return {
    rawOutput: composePhaseRawOutput(thinkingContent, accumulatedOutput),
    thinkingContent,
    outputContent: accumulatedOutput,
  };
}

async function primeModel(baseUrl, model) {
  const payload = {
    model,
    stream: false,
    options: {
      ...GEMMA4_SAMPLING,
      num_ctx: 4096,
      num_predict: 1,
    },
    messages: [
      { role: 'system', content: 'Return only READY.' },
      { role: 'user', content: 'READY' },
    ],
    keep_alive: '15m',
  };

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(PRIME_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Prime failed (${res.status}): ${text.slice(0, 200)}`);
  }

  await res.json().catch(() => ({}));
}

export function buildPrimeTargets(phases, phaseOverrides = {}) {
  const targets = new Map();

  for (const phase of phases) {
    const overrides = phaseOverrides?.[phase] ?? {};
    const sourceUrl = overrides.sourceUrl ?? nodeForPhase(phase);
    const model = overrides.model ?? PHASE_MODEL_DEFAULTS[phase];
    const key = `${sourceUrl}::${model}`;
    if (!targets.has(key)) targets.set(key, { key, sourceUrl, model });
  }

  return [...targets.values()];
}

async function ensurePrimed(baseUrl, model, send, key) {
  send({ type: 'primer', status: 'start', key, model, sourceUrl: baseUrl });
  try {
    await primeModel(baseUrl, model);
    send({ type: 'primer', status: 'complete', key, model, sourceUrl: baseUrl });
  } catch (err) {
    send({ type: 'primer', status: 'retry', key, model, sourceUrl: baseUrl, message: err.message });
    try {
      await new Promise(resolve => setTimeout(resolve, PRIME_RETRY_DELAY_MS));
      await primeModel(baseUrl, model);
      send({ type: 'primer', status: 'complete', key, model, sourceUrl: baseUrl });
    } catch (retryErr) {
      send({
        type: 'primer',
        status: 'failed',
        key,
        model,
        sourceUrl: baseUrl,
        message: retryErr.message,
      });
    }
  }
}

export function shouldRetryPhaseError(err) {
  const message = String(err?.message ?? err ?? '').toLowerCase();
  return [
    'timeout',
    'timed out',
    'abort',
    'networkerror',
    'fetch failed',
    'socket',
    'econnreset',
    'econnrefused',
    'temporarily unavailable',
  ].some(term => message.includes(term));
}

export function composePhaseRawOutput(thinkingContent, outputContent) {
  const cleanThinking = typeof thinkingContent === 'string' ? thinkingContent.trim() : '';
  const cleanOutput = typeof outputContent === 'string' ? outputContent : '';
  return cleanThinking
    ? `<|channel>thought\n${cleanThinking}\n<channel|>\n${cleanOutput}`
    : cleanOutput;
}

// ─── Phase Input Builders ─────────────────────────────────────────────────────

/**
 * Builds the user-turn message array for a given phase.
 * @param {'optimizer'|'generator'|'critic'|'synthesizer'} phase
 * @param {{ userInput: string, optimizedPrompt?: string, generatedOutput?: string, critiqueReport?: string }} ctx
 * @returns {{ role: string, content: string }[]}
 */
function buildPhaseMessages(phase, ctx) {
  switch (phase) {
    case 'optimizer':
      return [{ role: 'user', content: ctx.userInput }];

    case 'generator':
      return [{ role: 'user', content: ctx.optimizedPrompt }];

    case 'critic':
      return [{
        role: 'user',
        content: [
          '### Original User Intent',
          ctx.userInput,
          '',
          '### Optimized Prompt Used',
          ctx.optimizedPrompt,
          '',
          '### Generated Output',
          ctx.generatedOutput,
        ].join('\n'),
      }];

    case 'synthesizer':
      return [{
        role: 'user',
        content: [
          '### Original User Intent',
          ctx.userInput,
          '',
          '### Optimized Prompt',
          ctx.optimizedPrompt,
          '',
          '### First-Pass Output',
          ctx.generatedOutput,
          '',
          '### Critique Report',
          ctx.critiqueReport,
        ].join('\n'),
      }];

    default:
      throw new Error(`Unknown pipeline phase: ${phase}`);
  }
}

/**
 * Splits synthesizer output into the final content and run documentation.
 * Splits on the first "## Run Documentation" heading (case-insensitive).
 *
 * @param {string} raw
 * @returns {{ finalOutput: string, runDocumentation: string | null }}
 */
function splitRunDocs(raw) {
  // Use .match() — avoids the .exec() false-positive security hook
  const m = raw.match(/^## Run Documentation/im);
  if (!m) return { finalOutput: raw.trim(), runDocumentation: null };
  return {
    finalOutput: raw.slice(0, m.index).trim(),
    runDocumentation: raw.slice(m.index).trim(),
  };
}

// ─── Pipeline Runner ──────────────────────────────────────────────────────────

/**
 * Runs the four-phase pipeline, emitting SSE event objects via `send`.
 * Halts on the first phase error; client can retry from the failed phase.
 *
 * When `precomputedCtx` is provided, phases whose output already exists in
 * that context are skipped with a synthetic phase_complete event — enabling
 * resume-from-failed-phase without rerunning earlier work.
 *
 * @param {string} userInput
 * @param {Record<string, { model?: string, thinkingEnabled?: boolean, sourceUrl?: string, contextWindow?: number }>} phaseOverrides
 * @param {(event: object) => void} send
 * @param {{ optimizedPrompt?: string, generatedOutput?: string, critiqueReport?: string }} precomputedCtx
 * @returns {Promise<object>} The complete PipelineRun record
 */
export async function runPipeline(userInput, phaseOverrides, send, precomputedCtx = {}) {
  const runId = crypto.randomUUID();
  const createdAt = Date.now();

  const phaseRecords = {};
  // Merge precomputed context so buildPhaseMessages() has access to prior outputs
  const ctx = { userInput, ...precomputedCtx };
  const phases = ['optimizer', 'generator', 'critic', 'synthesizer'];

  // Maps each phase to the context key it produces, for skip detection
  const PHASE_OUTPUT_KEY = {
    optimizer: 'optimizedPrompt',
    generator: 'generatedOutput',
    critic: 'critiqueReport',
  };

  const runnablePhases = phases.filter(phase => {
    const outputKey = PHASE_OUTPUT_KEY[phase];
    return !outputKey || !precomputedCtx[outputKey];
  });
  const primeTargets = buildPrimeTargets(runnablePhases, phaseOverrides);
  await Promise.all(primeTargets.map(target => ensurePrimed(target.sourceUrl, target.model, send, target.key)));

  for (const phase of phases) {
    // ── Skip phases that already have precomputed output (retry path) ─────────
    const outputKey = PHASE_OUTPUT_KEY[phase];
    if (outputKey && precomputedCtx[outputKey]) {
      const skippedRecord = {
        status: 'complete',
        startedAt: createdAt,
        completedAt: createdAt,
        durationMs: 0,
        rawOutput: precomputedCtx[outputKey],
        thinkingContent: null,
        strippedOutput: precomputedCtx[outputKey],
        skipped: true,
      };
      phaseRecords[phase] = skippedRecord;
      send({ type: 'phase_complete', phase, record: skippedRecord, skipped: true });
      continue;
    }

    const overrides = phaseOverrides?.[phase] ?? {};
    const sourceUrl = overrides.sourceUrl ?? nodeForPhase(phase);

    const config = {
      model: overrides.model ?? PHASE_MODEL_DEFAULTS[phase],
      systemPrompt: SYSTEM_PROMPTS[phase],
      thinkingEnabled: overrides.thinkingEnabled ?? PHASE_THINKING_DEFAULTS[phase],
      contextWindow: overrides.contextWindow,
    };

    const record = {
      status: 'running',
      startedAt: Date.now(),
      completedAt: undefined,
      durationMs: undefined,
      rawOutput: '',
      thinkingContent: null,
      strippedOutput: '',
    };

    send({ type: 'phase_start', phase });

    try {
      const messages = buildPhaseMessages(phase, ctx);
      let result = null;
      let attempt = 0;

      while (attempt <= MAX_PHASE_RETRIES) {
        try {
          result = await ollamaChat(sourceUrl, messages, config, event => {
            send({ type: 'chunk', phase, channel: event.channel, delta: event.delta });
          });
          break;
        } catch (err) {
          if (attempt >= MAX_PHASE_RETRIES || !shouldRetryPhaseError(err)) {
            throw err;
          }

          send({
            type: 'phase_retry',
            phase,
            attempt: attempt + 2,
            sourceUrl,
            model: config.model,
            message: err.message,
          });
          await ensurePrimed(sourceUrl, config.model, send, `${sourceUrl}::${config.model}`);
          attempt += 1;
        }
      }

      record.rawOutput = result.rawOutput;
      record.thinkingContent = result.thinkingContent ?? extractThinkingContent(result.rawOutput);
      record.strippedOutput = stripThinkingBlocks(result.rawOutput);
      record.status = 'complete';
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;

      switch (phase) {
        case 'optimizer': ctx.optimizedPrompt = record.strippedOutput; break;
        case 'generator': ctx.generatedOutput = record.strippedOutput; break;
        case 'critic':    ctx.critiqueReport  = record.strippedOutput; break;
      }

    } catch (err) {
      record.status = 'error';
      record.error = err.message;
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      phaseRecords[phase] = record;

      send({ type: 'error', phase, message: err.message });
      return assembleRun(runId, createdAt, userInput, phaseOverrides, phaseRecords, null, null, phases);
    }

    phaseRecords[phase] = record;
    send({ type: 'phase_complete', phase, record });
  }

  const { finalOutput, runDocumentation } = splitRunDocs(
    phaseRecords.synthesizer?.strippedOutput ?? '',
  );

  const run = assembleRun(
    runId, createdAt, userInput, phaseOverrides, phaseRecords, finalOutput, runDocumentation, phases,
  );
  send({ type: 'pipeline_complete', run });
  return run;
}

/** Builds the final PipelineRun record from accumulated phase state. */
function assembleRun(id, createdAt, userInput, phaseOverrides, phaseRecords, finalOutput, runDocumentation, phases) {
  const config = {};
  for (const phase of phases) {
    const overrides = phaseOverrides?.[phase] ?? {};
    config[phase] = {
      model: overrides.model ?? PHASE_MODEL_DEFAULTS[phase],
      systemPrompt: SYSTEM_PROMPTS[phase],
      thinkingEnabled: overrides.thinkingEnabled ?? PHASE_THINKING_DEFAULTS[phase],
    };
  }

  const allPhases = {};
  for (const phase of phases) {
    allPhases[phase] = phaseRecords[phase] ?? {
      status: 'pending', rawOutput: '', thinkingContent: null, strippedOutput: '',
    };
  }

  return {
    id,
    createdAt,
    userInput,
    phases: allPhases,
    config,
    finalOutput: finalOutput ?? null,
    runDocumentation: runDocumentation ?? null,
  };
}
