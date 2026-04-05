import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative, dirname, basename } from 'path';
import { pathToFileURL } from 'url';

const ORGCHART_ROOT = resolve(import.meta.dir, '..', '.orgchart');
const AGENTS_DIR = join(ORGCHART_ROOT, 'agents');
const SKILLS_DIR = join(ORGCHART_ROOT, 'skills');
const TOOLS_DIR = join(ORGCHART_ROOT, 'tools');
const DATA_DIR = join(ORGCHART_ROOT, 'data');
const INTRANET_DIR = join(ORGCHART_ROOT, 'intranet');
const KNOWLEDGE_DIR = join(INTRANET_DIR, 'knowledge');
const TECHNOLOGY_DIR = join(INTRANET_DIR, 'technology');
const RECORDS_DIR = join(INTRANET_DIR, 'records');
const CUSTOM_TOOLS_DIR = join(ORGCHART_ROOT, 'custom-tools');
const PROJECTS_DIR = join(ORGCHART_ROOT, 'projects');

const DEFAULT_TOOLS = [
  {
    id: 'web-search',
    name: 'Web Search',
    type: 'web_search',
    description: 'Search DuckDuckGo and return structured result cards.',
    enabled: true,
    config: { engine: 'duckduckgo', region: 'us-en', safeSearch: 'moderate' },
  },
  {
    id: 'web-scrape',
    name: 'Web Scrape',
    type: 'web_scrape',
    description: 'Fetch a URL and extract readable text for agent review.',
    enabled: true,
    config: { maxChars: 12000, timeoutMs: 12000 },
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    type: 'wikipedia',
    description: 'Search Wikipedia topics and return focused article context.',
    enabled: true,
    config: { language: 'en', maxChars: 8000, includeSummary: true },
  },
  {
    id: 'memory-read',
    name: 'Memory Read',
    type: 'memory_read',
    description: 'Read files within an agent memory sandbox.',
    enabled: true,
    config: { scopes: ['working-memory', 'longterm-memory'] },
  },
  {
    id: 'memory-write',
    name: 'Memory Write',
    type: 'memory_write',
    description: 'Write new files within an agent memory sandbox.',
    enabled: true,
    config: { scopes: ['working-memory', 'longterm-memory'] },
  },
  {
    id: 'memory-update',
    name: 'Memory Update',
    type: 'memory_update',
    description: 'Update existing files within an agent memory sandbox.',
    enabled: true,
    config: { scopes: ['working-memory', 'longterm-memory'] },
  },
  {
    id: 'memory-delete',
    name: 'Memory Delete',
    type: 'memory_delete',
    description: 'Delete files within an agent memory sandbox.',
    enabled: true,
    config: { scopes: ['working-memory', 'longterm-memory'] },
  },
  {
    id: 'custom-tool-read',
    name: 'Custom Tool Read',
    type: 'custom_tool_read',
    description: 'Read files and metadata within the reviewed custom tool registry.',
    enabled: true,
    config: { root: 'custom-tools' },
  },
  {
    id: 'custom-tool-write',
    name: 'Custom Tool Write',
    type: 'custom_tool_write',
    description: 'Write reviewed custom tool source, docs, and metadata files.',
    enabled: true,
    config: { root: 'custom-tools' },
  },
  {
    id: 'custom-tool-patch',
    name: 'Custom Tool Patch',
    type: 'custom_tool_patch',
    description: 'Apply focused edits to reviewed custom tool files.',
    enabled: true,
    config: { root: 'custom-tools' },
  },
  {
    id: 'custom-tool-test',
    name: 'Custom Tool Test',
    type: 'custom_tool_test',
    description: 'Run custom tools against safe test inputs and capture the result.',
    enabled: true,
    config: { timeoutMs: 5000 },
  },
  {
    id: 'custom-tool-run',
    name: 'Custom Tool Run',
    type: 'custom_tool_run',
    description: 'Run registered custom tools manually through the constrained Bun wrapper.',
    enabled: true,
    config: { timeoutMs: 5000 },
  },
];

const DEFAULT_SKILLS = [
  {
    slug: 'web-browsing',
    name: 'web-browsing',
    title: 'Web Browsing',
    description: 'Use structured web search, targeted page scraping, and Wikipedia topic research to gather external context.',
    tools: ['web-search', 'web-scrape', 'wikipedia'],
    instructions: [
      'Use web search first to gather candidate sources.',
      'Use web scrape only for URLs surfaced by search or explicit user input.',
      'Use the Wikipedia tool for encyclopedic topic research, disambiguation, and concise background context.',
      'Prefer concise citations and summarize findings clearly.',
    ].join('\n'),
  },
  {
    slug: 'memory',
    name: 'memory',
    title: 'Memory',
    description: 'Store, retrieve, and maintain scoped working and long-term memory records.',
    tools: ['memory-read', 'memory-write', 'memory-update', 'memory-delete'],
    instructions: [
      'Use working memory for active task context and short-lived notes.',
      'Use long-term memory for durable facts, preferences, and decisions.',
      'Keep memory indexes current when files are created, updated, or removed.',
    ].join('\n'),
  },
  {
    slug: 'technologist',
    name: 'technologist',
    title: 'Technologist',
    description: 'Design, document, test, and extend organization-specific JavaScript tooling through the reviewed custom tool registry.',
    tools: ['custom-tool-read', 'custom-tool-write', 'custom-tool-patch', 'custom-tool-test', 'custom-tool-run'],
    instructions: [
      'Build focused JavaScript tools with clear metadata, tests, and documentation.',
      'Patch existing tools surgically rather than rewriting them wholesale.',
      'Provide safe test inputs and explain the intended operational boundaries.',
      'Keep Technology documentation synchronized with the actual tool behavior.',
    ].join('\n'),
  },
];

const DEFAULT_INTRANT_DOCS = [
  {
    section: 'knowledge',
    slug: 'company-wiki',
    title: 'Company Wiki',
    description: 'Institutional knowledge, onboarding, mission, internal processes, and evolving business documentation.',
    content: [
      '# Company Wiki',
      '',
      'Use this space for durable organizational knowledge.',
      '',
      '## Suggested topics',
      '- Mission and principles',
      '- Onboarding guides',
      '- Internal process documentation',
      '- Team workflow patterns',
    ].join('\n'),
  },
  {
    section: 'technology',
    slug: 'custom-tools',
    title: 'Custom Tools',
    description: 'Catalog of organization-specific tools, tests, and implementation notes.',
    content: [
      '# Custom Tools',
      '',
      'Document reviewed organization tooling here.',
      '',
      'Each custom tool should include:',
      '- Purpose and scope',
      '- Interface and expected inputs',
      '- Safe test procedure',
      '- Operational constraints',
    ].join('\n'),
  },
  {
    section: 'records',
    slug: 'operations-records',
    title: 'Operations Records',
    description: 'System-managed meeting transcripts, task runs, retrospectives, and artifacts.',
    content: [
      '# Operations Records',
      '',
      'This section is maintained by the application and stores durable operational history.',
    ].join('\n'),
  },
];

function titleFromSlug(slug) {
  return slug.split('-').filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

export function slugifyName(input, fallback = 'item') {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function parseFrontmatter(text) {
  const input = String(text ?? '');
  if (!input.startsWith('---\n')) return { meta: {}, body: input.trim() };
  const end = input.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: input.trim() };
  const head = input.slice(4, end).trim();
  const body = input.slice(end + 5).trim();
  const meta = {};
  for (const line of head.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (!key) continue;
    if ((rawValue.startsWith('[') && rawValue.endsWith(']')) || (rawValue.startsWith('{') && rawValue.endsWith('}'))) {
      try {
        meta[key] = JSON.parse(rawValue);
        continue;
      } catch { /* fall through */ }
    }
    meta[key] = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return { meta, body };
}

function serializeFrontmatter(meta, body) {
  const lines = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length))
    .map(([key, value]) => `${key}: ${Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  return ['---', ...lines, '---', '', String(body ?? '').trim(), ''].join('\n');
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function readMaybe(path, fallback = '') {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function listMarkdownFiles(dir, nestedFileName = null) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (nestedFileName && entry.isDirectory()) {
      const nested = join(dir, entry.name, nestedFileName);
      if (existsSync(nested)) files.push(nested);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(join(dir, entry.name));
    }
  }
  return files.sort();
}

function normalizeAgent(agent) {
  const slug = slugifyName(agent.slug || agent.name || agent.title || 'agent', 'agent');
  return {
    id: agent.id ?? `agent:${slug}`,
    slug,
    name: agent.name?.trim() || slug,
    title: agent.title?.trim() || '',
    description: agent.description?.trim() || '',
    instructions: agent.instructions?.trim() || '',
    roleId: agent.roleId?.trim() || '',
    skills: Array.isArray(agent.skills) ? Array.from(new Set(agent.skills.map(skill => slugifyName(skill)).filter(Boolean))) : [],
    color: agent.color?.trim() || 'blue',
  };
}

function normalizeSkill(skill) {
  const slug = slugifyName(skill.slug || skill.name || skill.title || 'skill', 'skill');
  return {
    id: skill.id ?? `skill:${slug}`,
    slug,
    name: skill.name?.trim() || slug,
    title: skill.title?.trim() || titleFromSlug(slug),
    description: skill.description?.trim() || '',
    instructions: skill.instructions?.trim() || '',
    tools: Array.isArray(skill.tools) ? Array.from(new Set(skill.tools.map(tool => slugifyName(tool)).filter(Boolean))) : [],
  };
}

function normalizeTool(tool) {
  const id = slugifyName(tool.id || tool.slug || tool.name || tool.type || 'tool', 'tool');
  return {
    id,
    name: tool.name?.trim() || titleFromSlug(id),
    type: tool.type?.trim() || id,
    description: tool.description?.trim() || '',
    enabled: tool.enabled !== false,
    config: tool.config && typeof tool.config === 'object' ? tool.config : {},
  };
}

function agentFilePath(slug) {
  return join(AGENTS_DIR, `${slugifyName(slug, 'agent')}.md`);
}

function skillFilePath(slug) {
  return join(SKILLS_DIR, slugifyName(slug, 'skill'), 'SKILL.md');
}

function toolFilePath(id) {
  return join(TOOLS_DIR, `${slugifyName(id, 'tool')}.json`);
}

function intranetSectionDir(section) {
  const value = slugifyName(section, 'knowledge');
  if (value === 'knowledge') return KNOWLEDGE_DIR;
  if (value === 'technology') return TECHNOLOGY_DIR;
  if (value === 'records') return RECORDS_DIR;
  throw new Error('Invalid intranet section.');
}

function intranetDocPath(section, slug) {
  return join(intranetSectionDir(section), `${slugifyName(slug, 'document')}.md`);
}

function customToolDir(slug) {
  return join(CUSTOM_TOOLS_DIR, slugifyName(slug, 'custom-tool'));
}

function customToolMetaPath(slug) {
  return join(customToolDir(slug), 'tool.json');
}

function customToolCodePath(slug) {
  return join(customToolDir(slug), 'index.js');
}

function customToolReadmePath(slug) {
  return join(customToolDir(slug), 'README.md');
}

export function normalizeCustomTool(tool) {
  const slug = slugifyName(tool.slug || tool.id || tool.name || 'custom-tool', 'custom-tool');
  return {
    id: tool.id?.trim() || `custom-${slug}`,
    slug,
    name: tool.name?.trim() || titleFromSlug(slug),
    description: tool.description?.trim() || '',
    enabled: tool.enabled !== false,
    entry: tool.entry?.trim() || 'index.js',
    docSlug: tool.docSlug?.trim() || slug,
    testInput: typeof tool.testInput === 'string' ? tool.testInput : '',
    instructions: tool.instructions?.trim() || '',
    code: typeof tool.code === 'string' ? tool.code : '',
    readme: typeof tool.readme === 'string' ? tool.readme : '',
  };
}

function assertSafeCustomToolCode(code) {
  const source = String(code ?? '');
  const bannedPatterns = [
    /\bchild_process\b/,
    /\bBun\.spawn\b/,
    /\bprocess\.exit\b/,
    /\bimport\s+.*\bfrom\s+['"]fs['"]/,
    /\bimport\s+.*\bfrom\s+['"]node:fs['"]/,
    /\bimport\s+.*\bfrom\s+['"]fs\/promises['"]/,
    /\bimport\s+.*\bfrom\s+['"]node:child_process['"]/,
  ];
  if (bannedPatterns.some(pattern => pattern.test(source))) {
    throw new Error('Custom tool code uses restricted runtime features.');
  }
}

export async function ensureOrgChartStore() {
  await Promise.all([
    ensureDir(AGENTS_DIR),
    ensureDir(SKILLS_DIR),
    ensureDir(TOOLS_DIR),
    ensureDir(DATA_DIR),
    ensureDir(KNOWLEDGE_DIR),
    ensureDir(TECHNOLOGY_DIR),
    ensureDir(RECORDS_DIR),
    ensureDir(CUSTOM_TOOLS_DIR),
    ensureDir(PROJECTS_DIR),
  ]);
  for (const tool of DEFAULT_TOOLS) {
    const path = toolFilePath(tool.id);
    const normalized = normalizeTool(tool);
    if (!existsSync(path)) {
      await writeJson(path, normalized);
      continue;
    }
    const existing = normalizeTool(await readJson(path, {}));
    await writeJson(path, {
      ...normalized,
      ...existing,
      config: { ...normalized.config, ...(existing.config ?? {}) },
    });
  }
  for (const skill of DEFAULT_SKILLS) {
    const path = skillFilePath(skill.slug);
    await ensureDir(dirname(path));
    if (!existsSync(path)) {
      await writeFile(path, serializeFrontmatter({
        name: skill.name,
        title: skill.title,
        description: skill.description,
        tools: skill.tools,
      }, skill.instructions), 'utf8');
      continue;
    }
    const current = parseFrontmatter(await readFile(path, 'utf8'));
    const mergedTools = Array.from(new Set([...(Array.isArray(current.meta.tools) ? current.meta.tools : []), ...skill.tools]));
    const body = String(current.body || '').includes('Wikipedia tool')
      ? current.body
      : `${String(current.body || '').trim()}\nUse the Wikipedia tool for encyclopedic topic research, disambiguation, and concise background context.`.trim();
    await writeFile(path, serializeFrontmatter({
      name: current.meta.name || skill.name,
      title: current.meta.title || skill.title,
      description: current.meta.description || skill.description,
      tools: mergedTools,
    }, body), 'utf8');
  }
  for (const doc of DEFAULT_INTRANT_DOCS) {
    const path = intranetDocPath(doc.section, doc.slug);
    if (!existsSync(path)) {
      await writeFile(path, serializeFrontmatter({
        title: doc.title,
        description: doc.description,
        section: doc.section,
      }, doc.content), 'utf8');
    }
  }
}

export async function listAgents() {
  await ensureOrgChartStore();
  const files = await listMarkdownFiles(AGENTS_DIR);
  const results = [];
  for (const file of files) {
    const { meta, body } = parseFrontmatter(await readFile(file, 'utf8'));
    results.push(normalizeAgent({
      id: meta.id,
      slug: basename(file, '.md'),
      name: meta.name,
      title: meta.title,
      description: meta.description,
      roleId: meta.roleId,
      color: meta.color,
      skills: meta.skills,
      instructions: body,
    }));
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function writeAgent(agent) {
  await ensureOrgChartStore();
  const normalized = normalizeAgent(agent);
  const path = agentFilePath(normalized.slug);
  await writeFile(path, serializeFrontmatter({
    id: normalized.id,
    name: normalized.name,
    title: normalized.title,
    description: normalized.description,
    roleId: normalized.roleId,
    color: normalized.color,
    skills: normalized.skills,
  }, normalized.instructions), 'utf8');
  await ensureAgentMemory(normalized.slug);
  return normalized;
}

export async function deleteAgent(slug) {
  const normalized = slugifyName(slug, 'agent');
  await rm(agentFilePath(normalized), { force: true });
  await rm(join(DATA_DIR, normalized), { recursive: true, force: true });
}

export async function listSkills() {
  await ensureOrgChartStore();
  const files = await listMarkdownFiles(SKILLS_DIR, 'SKILL.md');
  const results = [];
  for (const file of files) {
    const { meta, body } = parseFrontmatter(await readFile(file, 'utf8'));
    const slug = basename(dirname(file));
    results.push(normalizeSkill({
      id: meta.id,
      slug,
      name: meta.name,
      title: meta.title,
      description: meta.description,
      tools: meta.tools,
      instructions: body,
    }));
  }
  return results.sort((a, b) => a.title.localeCompare(b.title));
}

export async function writeSkill(skill) {
  await ensureOrgChartStore();
  const normalized = normalizeSkill(skill);
  const path = skillFilePath(normalized.slug);
  await ensureDir(dirname(path));
  await writeFile(path, serializeFrontmatter({
    id: normalized.id,
    name: normalized.name,
    title: normalized.title,
    description: normalized.description,
    tools: normalized.tools,
  }, normalized.instructions), 'utf8');
  return normalized;
}

export async function deleteSkill(slug) {
  const normalized = slugifyName(slug, 'skill');
  await rm(join(SKILLS_DIR, normalized), { recursive: true, force: true });
}

export async function listTools() {
  await ensureOrgChartStore();
  if (!existsSync(TOOLS_DIR)) return [];
  const entries = await readdir(TOOLS_DIR, { withFileTypes: true });
  const tools = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const json = await readJson(join(TOOLS_DIR, entry.name), null);
    if (!json) continue;
    tools.push(normalizeTool(json));
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

export async function writeTool(tool) {
  await ensureOrgChartStore();
  const normalized = normalizeTool(tool);
  await writeJson(toolFilePath(normalized.id), normalized);
  return normalized;
}

export async function bootstrapOrgChart() {
  const [agents, skills, tools, intranet, customTools] = await Promise.all([
    listAgents(),
    listSkills(),
    listTools(),
    listIntranet(),
    listCustomTools(),
  ]);
  return { agents, skills, tools, intranet, customTools };
}

export async function listIntranetDocs(section) {
  await ensureOrgChartStore();
  const dir = intranetSectionDir(section);
  const files = await listMarkdownFiles(dir);
  const docs = [];
  for (const file of files) {
    const { meta, body } = parseFrontmatter(await readFile(file, 'utf8'));
    docs.push({
      section: slugifyName(section),
      slug: basename(file, '.md'),
      title: meta.title || titleFromSlug(basename(file, '.md')),
      description: meta.description || '',
      content: body,
      updatedAt: meta.updatedAt || '',
      systemManaged: meta.systemManaged === 'true' || meta.systemManaged === true,
    });
  }
  return docs.sort((a, b) => a.title.localeCompare(b.title));
}

export async function listIntranet() {
  const [knowledge, technology, records] = await Promise.all([
    listIntranetDocs('knowledge'),
    listIntranetDocs('technology'),
    listIntranetDocs('records'),
  ]);
  return { knowledge, technology, records };
}

export async function writeIntranetDoc(section, doc) {
  await ensureOrgChartStore();
  const normalizedSection = slugifyName(section, 'knowledge');
  const slug = slugifyName(doc.slug || doc.title || 'document', 'document');
  const path = intranetDocPath(normalizedSection, slug);
  await writeFile(path, serializeFrontmatter({
    title: doc.title || titleFromSlug(slug),
    description: doc.description || '',
    section: normalizedSection,
    updatedAt: new Date().toISOString(),
    systemManaged: doc.systemManaged ? 'true' : 'false',
  }, doc.content || ''), 'utf8');
  return {
    section: normalizedSection,
    slug,
    title: doc.title || titleFromSlug(slug),
    description: doc.description || '',
    content: doc.content || '',
    updatedAt: new Date().toISOString(),
    systemManaged: Boolean(doc.systemManaged),
  };
}

export async function writeRecord(record) {
  const slug = slugifyName(record.slug || `${record.kind || 'record'}-${Date.now().toString(36)}`, 'record');
  return writeIntranetDoc('records', {
    slug,
    title: record.title || titleFromSlug(slug),
    description: record.description || '',
    content: record.content || '',
    systemManaged: true,
  });
}

export async function listCustomTools() {
  await ensureOrgChartStore();
  if (!existsSync(CUSTOM_TOOLS_DIR)) return [];
  const entries = await readdir(CUSTOM_TOOLS_DIR, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const meta = normalizeCustomTool(await readJson(customToolMetaPath(slug), { slug }));
    const code = await readMaybe(customToolCodePath(slug), '');
    const readme = await readMaybe(customToolReadmePath(slug), '');
    results.push({ ...meta, code, readme });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function writeCustomTool(tool) {
  await ensureOrgChartStore();
  const normalized = normalizeCustomTool(tool);
  assertSafeCustomToolCode(normalized.code);
  const dir = customToolDir(normalized.slug);
  await ensureDir(dir);
  await writeJson(customToolMetaPath(normalized.slug), {
    id: normalized.id,
    slug: normalized.slug,
    name: normalized.name,
    description: normalized.description,
    enabled: normalized.enabled,
    entry: normalized.entry,
    docSlug: normalized.docSlug,
    testInput: normalized.testInput,
    instructions: normalized.instructions,
  });
  await writeFile(customToolCodePath(normalized.slug), normalized.code || [
    'export async function run({ input }) {',
    '  return { ok: true, output: String(input ?? "").trim() };',
    '}',
    '',
  ].join('\n'), 'utf8');
  await writeFile(customToolReadmePath(normalized.slug), normalized.readme || `# ${normalized.name}\n\n${normalized.description}\n`, 'utf8');
  await writeTool({
    id: normalized.id,
    name: normalized.name,
    type: 'custom_tool',
    description: normalized.description,
    enabled: normalized.enabled,
    config: {
      slug: normalized.slug,
      entry: normalized.entry,
      docSlug: normalized.docSlug,
      testInput: normalized.testInput,
    },
  });
  await writeIntranetDoc('technology', {
    slug: normalized.docSlug,
    title: normalized.name,
    description: normalized.description,
    content: normalized.readme || `# ${normalized.name}\n\n${normalized.description}\n`,
    systemManaged: false,
  });
  return {
    ...normalized,
    code: await readMaybe(customToolCodePath(normalized.slug), ''),
    readme: await readMaybe(customToolReadmePath(normalized.slug), ''),
  };
}

function customToolModulePath(slug) {
  return pathToFileURL(customToolCodePath(slug)).href;
}

export async function runCustomTool(slug, input = '', mode = 'run') {
  await ensureOrgChartStore();
  const normalizedSlug = slugifyName(slug, 'custom-tool');
  const meta = normalizeCustomTool(await readJson(customToolMetaPath(normalizedSlug), { slug: normalizedSlug }));
  if (!meta.enabled) throw new Error('Custom tool is disabled.');
  const mod = await import(`${customToolModulePath(normalizedSlug)}?t=${Date.now()}`);
  if (typeof mod.run !== 'function') throw new Error('Custom tool must export an async run function.');
  const timeoutMs = 5000;
  const result = await Promise.race([
    Promise.resolve(mod.run({ input, mode, meta })),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Custom tool timed out.')), timeoutMs)),
  ]);
  return { slug: normalizedSlug, mode, result };
}

function allowedMemoryScope(scope) {
  return scope === 'working-memory' || scope === 'longterm-memory' ? scope : null;
}

function safeRelativeFile(name) {
  const candidate = String(name ?? '').trim().replace(/^\/+/, '');
  if (!candidate || candidate.includes('..')) throw new Error('Invalid memory file path.');
  return candidate;
}

export async function ensureAgentMemory(agentSlug) {
  await ensureOrgChartStore();
  const slug = slugifyName(agentSlug, 'agent');
  const root = join(DATA_DIR, slug);
  const workingDir = join(root, 'working-memory');
  const longtermDir = join(root, 'longterm-memory');
  await Promise.all([
    ensureDir(workingDir),
    ensureDir(longtermDir),
  ]);
  const workingIndexPath = join(root, 'working-memory.json');
  const longtermIndexPath = join(root, 'longterm-memory.json');
  if (!existsSync(workingIndexPath)) await writeJson(workingIndexPath, { files: [] });
  if (!existsSync(longtermIndexPath)) await writeJson(longtermIndexPath, { files: [] });
  return { root, workingDir, longtermDir, workingIndexPath, longtermIndexPath };
}

export function resolveMemoryPath(agentSlug, scope, fileName = '') {
  const slug = slugifyName(agentSlug, 'agent');
  const safeScope = allowedMemoryScope(scope);
  if (!safeScope) throw new Error('Invalid memory scope.');
  const root = join(DATA_DIR, slug, safeScope);
  const resolved = resolve(root, safeRelativeFile(fileName || '.'));
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || rel.includes(`..${basename(root)}`)) throw new Error('Memory file path escapes sandbox.');
  return resolved;
}

async function syncMemoryIndex(agentSlug, scope) {
  const memory = await ensureAgentMemory(agentSlug);
  const dir = scope === 'working-memory' ? memory.workingDir : memory.longtermDir;
  const indexPath = scope === 'working-memory' ? memory.workingIndexPath : memory.longtermIndexPath;
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    const info = await stat(path);
    files.push({
      name: entry.name,
      updatedAt: info.mtime.toISOString(),
      size: info.size,
    });
  }
  await writeJson(indexPath, { files: files.sort((a, b) => a.name.localeCompare(b.name)) });
  return readJson(indexPath, { files: [] });
}

export async function memoryRead(agentSlug, scope, fileName) {
  await ensureAgentMemory(agentSlug);
  const path = resolveMemoryPath(agentSlug, scope, fileName);
  return {
    fileName: safeRelativeFile(fileName),
    scope,
    content: await readMaybe(path, ''),
    index: await syncMemoryIndex(agentSlug, scope),
  };
}

export async function memoryWrite(agentSlug, scope, fileName, content) {
  const path = resolveMemoryPath(agentSlug, scope, fileName);
  await ensureDir(dirname(path));
  await writeFile(path, String(content ?? ''), 'utf8');
  return memoryRead(agentSlug, scope, fileName);
}

export async function memoryDelete(agentSlug, scope, fileName) {
  const path = resolveMemoryPath(agentSlug, scope, fileName);
  await rm(path, { force: true });
  return {
    fileName: safeRelativeFile(fileName),
    scope,
    deleted: true,
    index: await syncMemoryIndex(agentSlug, scope),
  };
}

export async function memoryIndex(agentSlug, scope) {
  await ensureAgentMemory(agentSlug);
  const safeScope = allowedMemoryScope(scope);
  if (!safeScope) throw new Error('Invalid memory scope.');
  return syncMemoryIndex(agentSlug, safeScope);
}

export function normalizeDuckDuckGoHtml(html, limit = 8) {
  const text = String(html ?? '');
  const resultRegex = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*\bresult\b|$)/gi;
  const results = [];
  let block;
  while ((block = resultRegex.exec(text)) !== null && results.length < limit) {
    const fragment = block[1];
    const titleMatch = fragment.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const snippetMatch = fragment.match(/<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const url = decodeHtml(titleMatch[1] || '');
    const title = cleanHtml(titleMatch[2] || '');
    const snippet = cleanHtml(snippetMatch?.[1] || '');
    if (!url || !title) continue;
    results.push({ title, url, snippet });
  }
  return results;
}

function decodeHtml(text) {
  return String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanHtml(text) {
  return decodeHtml(String(text ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

export function extractReadableText(html, maxChars = 12000) {
  const cleaned = cleanHtml(String(html ?? ''));
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}…` : cleaned;
}

export function normalizeWikipediaExtract(text, maxChars = 8000) {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}…` : cleaned;
}

export function buildWikipediaPageUrl(title, language = 'en') {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(String(title ?? '').replace(/\s+/g, '_'))}`;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

function projectFilePath(id) {
  return join(PROJECTS_DIR, `${slugifyName(id, 'project')}.json`);
}

function normalizeProject(project) {
  const id = project.id?.trim() || `project-${Date.now().toString(36)}`;
  return {
    id,
    name: project.name?.trim() || 'Untitled Project',
    description: project.description?.trim() || '',
    status: ['planning', 'active', 'paused', 'completed', 'archived'].includes(project.status)
      ? project.status : 'planning',
    ownerId: project.ownerId?.trim() || '',
    departmentId: project.departmentId?.trim() || '',
    teamId: project.teamId?.trim() || '',
    deadline: project.deadline?.trim() || '',
    milestones: Array.isArray(project.milestones) ? project.milestones.map(m => ({
      id: m.id?.trim() || `milestone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: m.name?.trim() || '',
      description: m.description?.trim() || '',
      status: ['pending', 'in-progress', 'completed', 'blocked'].includes(m.status) ? m.status : 'pending',
      deadline: m.deadline?.trim() || '',
      completedAt: m.completedAt?.trim() || '',
      linkedArtifacts: Array.isArray(m.linkedArtifacts) ? m.linkedArtifacts : [],
    })) : [],
    linkedMeetingIds: Array.isArray(project.linkedMeetingIds) ? project.linkedMeetingIds : [],
    linkedTaskIds: Array.isArray(project.linkedTaskIds) ? project.linkedTaskIds : [],
    notes: project.notes?.trim() || '',
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listProjects() {
  await ensureOrgChartStore();
  if (!existsSync(PROJECTS_DIR)) return [];
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const data = await readJson(join(PROJECTS_DIR, entry.name), null);
    if (data) projects.push(normalizeProject(data));
  }
  return projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function writeProject(project) {
  await ensureOrgChartStore();
  const normalized = normalizeProject(project);
  await writeJson(projectFilePath(normalized.id), normalized);
  return normalized;
}

export async function deleteProject(id) {
  await rm(projectFilePath(slugifyName(id, 'project')), { force: true });
}

export {
  ORGCHART_ROOT,
  AGENTS_DIR,
  SKILLS_DIR,
  TOOLS_DIR,
  DATA_DIR,
  INTRANET_DIR,
  KNOWLEDGE_DIR,
  TECHNOLOGY_DIR,
  RECORDS_DIR,
  CUSTOM_TOOLS_DIR,
  PROJECTS_DIR,
  DEFAULT_TOOLS,
  DEFAULT_SKILLS,
  parseFrontmatter,
  serializeFrontmatter,
  normalizeAgent,
  normalizeSkill,
  normalizeTool,
  assertSafeCustomToolCode,
};
