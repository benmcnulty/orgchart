import { describe, expect, test } from 'bun:test';
import {
  assertSafeCustomToolCode,
  buildWikipediaPageUrl,
  DEFAULT_SKILLS,
  DEFAULT_TOOLS,
  normalizeCustomTool,
  normalizeDuckDuckGoHtml,
  normalizeTool,
  normalizeWikipediaExtract,
  parseFrontmatter,
  resolveMemoryPath,
  serializeFrontmatter,
  slugifyName,
} from '../lib/orgchart-store.js';

describe('orgchart-store helpers', () => {
  test('slugifyName normalizes names for disk layout', () => {
    expect(slugifyName('Steve Jobs')).toBe('steve-jobs');
    expect(slugifyName('  Web Browsing  ')).toBe('web-browsing');
    expect(slugifyName('')).toBe('item');
  });

  test('frontmatter serialization round-trips metadata and body', () => {
    const text = serializeFrontmatter({
      name: 'web-browsing',
      description: 'Search and scrape.',
      tools: ['web-search', 'web-scrape'],
    }, 'Use search first.');

    const parsed = parseFrontmatter(text);
    expect(parsed.meta.name).toBe('web-browsing');
    expect(parsed.meta.tools).toEqual(['web-search', 'web-scrape']);
    expect(parsed.body).toBe('Use search first.');
  });

  test('normalizeDuckDuckGoHtml extracts structured results', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://example.com/a">Alpha Result</a>
        <div class="result__snippet">First snippet.</div>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.com/b">Beta Result</a>
        <a class="result__snippet">Second snippet.</a>
      </div>
    `;

    expect(normalizeDuckDuckGoHtml(html)).toEqual([
      { title: 'Alpha Result', url: 'https://example.com/a', snippet: 'First snippet.' },
      { title: 'Beta Result', url: 'https://example.com/b', snippet: 'Second snippet.' },
    ]);
  });

  test('resolveMemoryPath rejects sandbox escapes', () => {
    expect(() => resolveMemoryPath('steve', 'working-memory', 'notes.txt')).not.toThrow();
    expect(() => resolveMemoryPath('steve', 'working-memory', '../secrets.txt')).toThrow(/Invalid memory file path|escapes sandbox/);
  });

  test('normalizeTool applies safe defaults', () => {
    expect(normalizeTool({ id: 'web-search', config: null })).toEqual({
      id: 'web-search',
      name: 'Web Search',
      type: 'web-search',
      description: '',
      enabled: true,
      config: {},
    });
  });

  test('default web browsing skill includes wikipedia support', () => {
    const webBrowsing = DEFAULT_SKILLS.find(skill => skill.slug === 'web-browsing');
    expect(webBrowsing?.tools).toContain('wikipedia');
    expect(DEFAULT_TOOLS.some(tool => tool.id === 'wikipedia' && tool.type === 'wikipedia')).toBe(true);
  });

  test('default technologist skill includes reviewed custom tool capabilities', () => {
    const technologist = DEFAULT_SKILLS.find(skill => skill.slug === 'technologist');
    expect(technologist?.tools).toEqual([
      'custom-tool-read',
      'custom-tool-write',
      'custom-tool-patch',
      'custom-tool-test',
      'custom-tool-run',
    ]);
    expect(DEFAULT_TOOLS.some(tool => tool.id === 'custom-tool-run' && tool.type === 'custom_tool_run')).toBe(true);
  });

  test('normalizeCustomTool applies registry-safe defaults', () => {
    expect(normalizeCustomTool({ name: 'Ops Helper' })).toEqual({
      id: 'custom-ops-helper',
      slug: 'ops-helper',
      name: 'Ops Helper',
      description: '',
      enabled: true,
      entry: 'index.js',
      docSlug: 'ops-helper',
      testInput: '',
      instructions: '',
      code: '',
      readme: '',
    });
  });

  test('assertSafeCustomToolCode blocks restricted runtime primitives', () => {
    expect(() => assertSafeCustomToolCode("import fs from 'fs';")).toThrow(/restricted runtime features/);
    expect(() => assertSafeCustomToolCode('export async function run() { return { ok: true }; }')).not.toThrow();
  });

  test('wikipedia helpers normalize extracts and build article urls', () => {
    expect(normalizeWikipediaExtract(' Alpha   Beta  ', 50)).toBe('Alpha Beta');
    expect(buildWikipediaPageUrl('Alan Turing')).toBe('https://en.wikipedia.org/wiki/Alan_Turing');
  });
});
