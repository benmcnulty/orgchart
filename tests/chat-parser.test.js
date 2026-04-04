import { describe, expect, test } from 'bun:test';

async function loadChatParser() {
  const policySource = await Bun.file('./public/inference-policy.js').text();
  const chatSource = await Bun.file('./public/chat.js').text();
  return new Function(`
    globalThis.window = globalThis;
    ${policySource}
    ${chatSource}
    return { ChatThinkingParser };
  `)();
}

describe('ChatThinkingParser', () => {
  test('handles <thought> tags split across chunks', async () => {
    const { ChatThinkingParser } = await loadChatParser();
    const parser = new ChatThinkingParser();

    const first = parser.feed({ message: { content: '<tho' } });
    expect(first.textDelta).toBe('');

    const second = parser.feed({ message: { content: 'ught>plan</thought>Answer' } });
    expect(second.thinkingDelta).toContain('plan');
    expect(second.textDelta).toBe('Answer');
  });

  test('prefers native thinking fields when present', async () => {
    const { ChatThinkingParser } = await loadChatParser();
    const parser = new ChatThinkingParser();
    const result = parser.feed({ message: { thinking: 'native trace', content: 'Visible answer' } });
    expect(result.thinkingDelta).toContain('native trace');
    expect(result.textDelta).toBe('Visible answer');
  });
});
