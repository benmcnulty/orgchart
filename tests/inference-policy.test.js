import { describe, expect, test } from 'bun:test';

async function loadPolicy() {
  const source = await Bun.file('./public/inference-policy.js').text();
  return new Function(`${source}; return globalThis.InferencePolicy;`)();
}

describe('InferencePolicy', () => {
  test('detects Gemma small vs large tiers', async () => {
    const policy = await loadPolicy();
    expect(policy.detectModelPolicy('gemma4:2b-it-q4_K_M').tier).toBe('small_structured');
    expect(policy.detectModelPolicy('gemma4:latest').tier).toBe('large_reasoning');
    expect(policy.detectModelPolicy('llama3.2').tier).toBe('generic_fallback');
  });

  test('builds XML-structured workflow messages', async () => {
    const policy = await loadPolicy();
    const built = policy.buildWorkflowMessages({
      modelName: 'gemma4:2b',
      workflow: 'meeting_summary',
      role: 'You are a summarizer.',
      instructions: ['Keep it concise.'],
      context: { agenda: '1. Review\n2. Decide' },
      input: 'Summarize the meeting.',
      outputFormat: 'Return only the summary.',
      includeThought: true,
    });

    expect(built.messages).toHaveLength(2);
    expect(built.messages[0].content).toContain('<workflow>');
    expect(built.messages[0].content).toContain('<execution_rules>');
    expect(built.messages[1].content).toContain('<input_data>');
    expect(built.messages[1].content).toContain('<output_format>');
  });

  test('parses structured thought tags from final text', async () => {
    const policy = await loadPolicy();
    const parsed = policy.parseStructuredResponse('<thought>step 1\nstep 2</thought>\nFinal answer');
    expect(parsed.thought).toContain('step 1');
    expect(parsed.answer).toBe('Final answer');
  });
});
