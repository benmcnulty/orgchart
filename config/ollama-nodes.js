/**
 * Ollama node configuration for multi-endpoint inference routing.
 *
 * For single-node setups: PRIMARY_URL defaults to localhost and SECONDARY_URL
 * mirrors it, so all phases route to the same machine without any extra config.
 *
 * For tandem setups (e.g., Vic + Pav on LAN), set environment variables:
 *   OLLAMA_PRIMARY_URL=http://192.168.x.vic:11434
 *   OLLAMA_SECONDARY_URL=http://192.168.x.pav:11434
 *
 * PHASE_NODE_MAP assigns the heavier phases (generator, synthesizer) to the
 * primary node and lighter phases (optimizer, critic) to secondary, matching
 * the recommended model sizing in the spec:
 *   Primary:   gemma4:26b / gemma4:31b (high VRAM — Vic)
 *   Secondary: gemma4:e4b / gemma4:e2b (fits RTX 3060 / GTX 1060 — Pav)
 */

export const OLLAMA_NODES = {
  primary: process.env.OLLAMA_PRIMARY_URL ?? 'http://localhost:11434',
  secondary: process.env.OLLAMA_SECONDARY_URL ?? process.env.OLLAMA_PRIMARY_URL ?? 'http://localhost:11434',
};

/** @type {Record<string, keyof typeof OLLAMA_NODES>} */
export const PHASE_NODE_MAP = {
  optimizer: 'secondary',
  generator: 'primary',
  critic: 'secondary',
  synthesizer: 'primary',
};

/**
 * Returns the base URL for a given phase name.
 * Falls back to primary if the phase name is not in the map.
 *
 * @param {string} phase
 * @returns {string}
 */
export function nodeForPhase(phase) {
  const key = PHASE_NODE_MAP[phase] ?? 'primary';
  return OLLAMA_NODES[key] ?? OLLAMA_NODES.primary;
}
