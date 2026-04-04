import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildPrimeTargets,
  composePhaseRawOutput,
  runPipeline,
  shouldRetryPhaseError,
} from '../lib/pipeline-runner.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function makeNdjsonResponse(lines) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join('\n') + '\n'));
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

describe('pipeline-runner helpers', () => {
  test('deduplicates primer targets across phases', () => {
    const targets = buildPrimeTargets(['optimizer', 'generator', 'critic'], {
      optimizer: { sourceUrl: 'http://air:11434', model: 'gemma4:e4b' },
      generator: { sourceUrl: 'http://air:11434', model: 'gemma4:e4b' },
      critic: { sourceUrl: 'http://vic:11434', model: 'gemma4:latest' },
    });

    expect(targets).toEqual([
      { key: 'http://air:11434::gemma4:e4b', sourceUrl: 'http://air:11434', model: 'gemma4:e4b' },
      { key: 'http://vic:11434::gemma4:latest', sourceUrl: 'http://vic:11434', model: 'gemma4:latest' },
    ]);
  });

  test('composes one canonical thinking block around final output', () => {
    expect(composePhaseRawOutput('step 1\nstep 2', 'Final answer.')).toBe(
      '<|channel>thought\nstep 1\nstep 2\n<channel|>\nFinal answer.',
    );
    expect(composePhaseRawOutput('', 'Only output.')).toBe('Only output.');
  });

  test('retries only timeout-like failures', () => {
    expect(shouldRetryPhaseError(new Error('Request timed out after 180000ms'))).toBe(true);
    expect(shouldRetryPhaseError(new Error('fetch failed: socket hang up'))).toBe(true);
    expect(shouldRetryPhaseError(new Error('Ollama error (404): model not found'))).toBe(false);
  });
});

describe('runPipeline', () => {
  test('re-primes and retries a timed-out phase while keeping thinking/output separate', async () => {
    const events = [];
    let callIndex = 0;

    global.fetch = async () => {
      callIndex += 1;

      if (callIndex === 1 || callIndex === 3) {
        return new Response(JSON.stringify({ message: { content: 'READY' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (callIndex === 2) {
        throw new Error('Request timed out after 180000ms');
      }

      if (callIndex === 4) {
        return makeNdjsonResponse([
          JSON.stringify({ message: { thinking: 'Plan the answer.' } }),
          JSON.stringify({ message: { content: 'Final answer.' } }),
        ]);
      }

      throw new Error(`Unexpected fetch call ${callIndex}`);
    };

    const run = await runPipeline(
      'Write a short answer.',
      {
        optimizer: { sourceUrl: 'http://air:11434', model: 'gemma4:e4b', thinkingEnabled: true },
        generator: { sourceUrl: 'http://air:11434', model: 'gemma4:e4b', thinkingEnabled: true },
        critic: { sourceUrl: 'http://air:11434', model: 'gemma4:e4b', thinkingEnabled: true },
        synthesizer: { sourceUrl: 'http://air:11434', model: 'gemma4:e4b', thinkingEnabled: true },
      },
      event => events.push(event),
      {
        optimizedPrompt: 'Optimized prompt.',
        generatedOutput: 'Draft output.',
        critiqueReport: 'Critique report.',
      },
    );

    expect(events.filter(event => event.type === 'primer')).toHaveLength(4);
    expect(events.filter(event => event.type === 'primer' && event.status === 'complete')).toHaveLength(2);
    expect(events.some(event => event.type === 'phase_retry' && event.phase === 'synthesizer')).toBe(true);
    expect(events).toContainEqual({
      type: 'chunk',
      phase: 'synthesizer',
      channel: 'thinking',
      delta: 'Plan the answer.',
    });
    expect(events).toContainEqual({
      type: 'chunk',
      phase: 'synthesizer',
      channel: 'output',
      delta: 'Final answer.',
    });
    expect(run.phases.synthesizer.thinkingContent).toBe('Plan the answer.');
    expect(run.phases.synthesizer.strippedOutput).toBe('Final answer.');
    expect(run.finalOutput).toBe('Final answer.');
  });

  test('does not abort when warm-up fails for the runnable phase model', async () => {
    const events = [];
    let callIndex = 0;

    global.fetch = async () => {
      callIndex += 1;

      if (callIndex === 1 || callIndex === 2) {
        return new Response(JSON.stringify({ error: "model 'gemma4:e4b' not found" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (callIndex === 3) {
        return makeNdjsonResponse([
          JSON.stringify({ message: { thinking: 'Recover after warm-up failure.' } }),
          JSON.stringify({ message: { content: 'Recovered output.' } }),
        ]);
      }

      throw new Error(`Unexpected fetch call ${callIndex}`);
    };

    const run = await runPipeline(
      'Write a short answer.',
      {
        synthesizer: { sourceUrl: 'http://air:11434', model: 'gemma4:e4b', thinkingEnabled: true },
      },
      event => events.push(event),
      {
        optimizedPrompt: 'Optimized prompt.',
        generatedOutput: 'Draft output.',
        critiqueReport: 'Critique report.',
      },
    );

    expect(events.filter(event => event.type === 'primer')).toEqual([
      {
        type: 'primer',
        status: 'start',
        key: 'http://air:11434::gemma4:e4b',
        model: 'gemma4:e4b',
        sourceUrl: 'http://air:11434',
      },
      {
        type: 'primer',
        status: 'retry',
        key: 'http://air:11434::gemma4:e4b',
        model: 'gemma4:e4b',
        sourceUrl: 'http://air:11434',
        message: "Prime failed (404): {\"error\":\"model 'gemma4:e4b' not found\"}",
      },
      {
        type: 'primer',
        status: 'failed',
        key: 'http://air:11434::gemma4:e4b',
        model: 'gemma4:e4b',
        sourceUrl: 'http://air:11434',
        message: "Prime failed (404): {\"error\":\"model 'gemma4:e4b' not found\"}",
      },
    ]);
    expect(run.phases.optimizer.skipped).toBe(true);
    expect(run.phases.synthesizer.strippedOutput).toBe('Recovered output.');
    expect(run.finalOutput).toBe('Recovered output.');
  });
});
