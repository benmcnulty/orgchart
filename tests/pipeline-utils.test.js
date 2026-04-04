import { describe, expect, test } from 'bun:test';
import { stripThinkingBlocks, extractThinkingContent } from '../lib/gemma4-utils.js';

// ─── stripThinkingBlocks ──────────────────────────────────────────────────────

describe('stripThinkingBlocks', () => {
  test('strips Gemma 4 native channel thinking block', () => {
    const raw =
      '<|channel>thought\nI should consider this carefully.\n<channel|>\nHere is my answer.';
    expect(stripThinkingBlocks(raw)).toBe('Here is my answer.');
  });

  test('strips legacy <think> tags', () => {
    const raw = '<think>my internal reasoning</think>\nFinal answer here.';
    expect(stripThinkingBlocks(raw)).toBe('Final answer here.');
  });

  test('strips legacy <thought> tags', () => {
    const raw = '<thought>step 1\nstep 2</thought>\nThe result is 42.';
    expect(stripThinkingBlocks(raw)).toBe('The result is 42.');
  });

  test('strips multiple thinking blocks in one string', () => {
    const raw = '<think>first</think> middle <think>second</think> final';
    const stripped = stripThinkingBlocks(raw);
    expect(stripped).not.toContain('<think>');
    expect(stripped).toContain('middle');
    expect(stripped).toContain('final');
  });

  test('returns clean text unchanged (no-op on content-only strings)', () => {
    const clean = 'Just a normal response with no thinking blocks.';
    expect(stripThinkingBlocks(clean)).toBe(clean);
  });

  test('returns empty string for empty input', () => {
    expect(stripThinkingBlocks('')).toBe('');
  });

  test('handles non-string input gracefully — returns empty string', () => {
    expect(stripThinkingBlocks(null)).toBe('');
    expect(stripThinkingBlocks(undefined)).toBe('');
    // @ts-ignore intentional wrong type for robustness test
    expect(stripThinkingBlocks(42)).toBe('');
  });

  test('does not strip malformed/unclosed tags (non-greedy requires both tags)', () => {
    const raw = '<think>this is never closed and should stay as-is';
    // Non-greedy regex requires a matching closing tag — no match → no change
    expect(stripThinkingBlocks(raw)).toBe(raw);
  });

  test('handles multiline thinking blocks across many lines', () => {
    const raw = [
      '<|channel>thought',
      'Line one of thinking.',
      'Line two of thinking.',
      'Line three.',
      '<channel|>',
      'The actual answer starts here.',
    ].join('\n');
    expect(stripThinkingBlocks(raw)).toBe('The actual answer starts here.');
  });

  test('strips mixed Gemma4 and legacy blocks in the same string', () => {
    const raw =
      '<|channel>thought\ngemma thinking\n<channel|>\n' +
      'Intro text. ' +
      '<think>legacy thinking</think>' +
      ' Final text.';
    const stripped = stripThinkingBlocks(raw);
    expect(stripped).not.toContain('<|channel>');
    expect(stripped).not.toContain('<think>');
    expect(stripped).toContain('Intro text.');
    expect(stripped).toContain('Final text.');
  });
});

// ─── extractThinkingContent ───────────────────────────────────────────────────

describe('extractThinkingContent', () => {
  test('extracts Gemma 4 native channel thinking content', () => {
    const raw =
      '<|channel>thought\nI need to consider the options.\n<channel|>\nMy recommendation is X.';
    expect(extractThinkingContent(raw)).toBe('I need to consider the options.');
  });

  test('extracts legacy <think> content', () => {
    const raw = '<think>step 1\nstep 2</think>\nFinal answer.';
    expect(extractThinkingContent(raw)).toBe('step 1\nstep 2');
  });

  test('extracts legacy <thought> content (case-insensitive)', () => {
    const raw = '<thought>Planning phase\nDecision made</thought>\nOutput.';
    expect(extractThinkingContent(raw)).toBe('Planning phase\nDecision made');
  });

  test('returns null for clean text with no thinking blocks', () => {
    expect(extractThinkingContent('No thinking here, just a plain response.')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(extractThinkingContent('')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(extractThinkingContent(null)).toBeNull();
    expect(extractThinkingContent(undefined)).toBeNull();
    // @ts-ignore intentional wrong type
    expect(extractThinkingContent(0)).toBeNull();
  });

  test('prefers Gemma 4 native format over legacy when both present', () => {
    const raw =
      '<|channel>thought\ngemma thinking content\n<channel|>\n' +
      '<think>legacy thinking content</think>\n' +
      'Answer.';
    expect(extractThinkingContent(raw)).toBe('gemma thinking content');
  });

  test('returns null for empty thinking block (whitespace only)', () => {
    // An empty thinking block (e.g., model opened but closed immediately)
    const raw = '<think>   </think>\nAnswer here.';
    expect(extractThinkingContent(raw)).toBeNull();
  });

  test('extracts multiline Gemma 4 thinking content correctly', () => {
    const raw = '<|channel>thought\nFirst line.\nSecond line.\nThird line.\n<channel|>\nAnswer.';
    const content = extractThinkingContent(raw);
    expect(content).toContain('First line.');
    expect(content).toContain('Second line.');
    expect(content).toContain('Third line.');
  });
});
