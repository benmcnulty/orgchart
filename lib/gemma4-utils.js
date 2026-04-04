/**
 * Gemma 4 thinking-block utilities.
 *
 * Gemma 4 via Ollama may embed thinking content in raw output in two formats:
 *   1. Native channel format:  <|channel>thought\n…content…\n<channel|>
 *   2. Legacy tag formats:     <think>…</think>  /  <thought>…</thought>
 *
 * IMPORTANT: stripThinkingBlocks() is load-bearing for the multiphase pipeline.
 * It MUST be applied before passing output between phases or into conversation
 * history — thinking tokens pollute phase inputs and degrade output quality.
 */

// Gemma 4 native channel format (non-greedy to handle multiple blocks)
const GEMMA4_THINK_RE = /<\|channel>thought\n[\s\S]*?<channel\|>/g;

// Legacy inline thinking tags — DeepSeek-R1, older Gemma configs, inference-policy.js
const LEGACY_THINK_RE = /<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/gi;

/**
 * Strips all thinking blocks from raw model output.
 *
 * Handles both Gemma 4 native channel format and legacy <think>/<thought> tags.
 * Safe to call on any string — returns the input unchanged if no blocks found.
 * Non-string input returns an empty string rather than throwing.
 *
 * @param {string} raw - Raw model output possibly containing thinking blocks.
 * @returns {string} Output with all thinking blocks removed and trimmed.
 */
export function stripThinkingBlocks(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(GEMMA4_THINK_RE, '')
    .replace(LEGACY_THINK_RE, '')
    .trim();
}

/**
 * Extracts the content of the first thinking block for display or logging.
 *
 * Checks Gemma 4 native format first, then falls back to legacy tags.
 * Returns null if no thinking block is present (expected when thinking is
 * disabled, or for models that don't emit thinking tokens).
 *
 * @param {string} raw - Raw model output.
 * @returns {string|null} Thinking block content (trimmed), or null.
 */
export function extractThinkingContent(raw) {
  if (typeof raw !== 'string') return null;

  // Gemma 4 native: <|channel>thought\n{content}\n<channel|>
  const gemmaMatch = raw.match(/<\|channel>thought\n([\s\S]*?)<channel\|>/);
  if (gemmaMatch) return gemmaMatch[1].trim() || null;

  // Legacy: <think>{content}</think> or <thought>{content}</thought>
  const legacyMatch = raw.match(/<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/i);
  if (legacyMatch) return legacyMatch[1].trim() || null;

  return null;
}
