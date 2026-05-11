import { load, dump } from 'js-yaml';

export interface NoteFrontmatter {
  tags?: string[];
  created?: string;
  [key: string]: unknown;
}

export function parseNote(raw: string): { frontmatter: NoteFrontmatter; body: string } {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }

  // Match: ---\n<yaml>\n---\n<body>
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const yamlStr = match[1];
  const body = match[2];

  try {
    const data = (load(yamlStr) as Record<string, unknown>) ?? {};
    // js-yaml parses bare YYYY-MM-DD as Date objects; normalize back to strings.
    const frontmatter: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      frontmatter[k] = v instanceof Date ? v.toISOString().split('T')[0] : v;
    }
    return { frontmatter: frontmatter as NoteFrontmatter, body };
  } catch {
    return { frontmatter: {}, body: raw };
  }
}

export function serializeNote(frontmatter: NoteFrontmatter, body: string): string {
  if (Object.keys(frontmatter).length === 0) return body;
  const yamlStr = dump(frontmatter);
  return `---\n${yamlStr}---\n${body}`;
}

export function createDefaultNote(title: string): string {
  const now = new Date().toISOString();
  const yamlStr = dump({ tags: [], created: now });
  return `---\n${yamlStr}---\n\n# ${title}\n`;
}
