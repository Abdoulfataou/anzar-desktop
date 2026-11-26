/**
 * Format SKILL.md (standard ouvert agentskills.io) : frontmatter YAML simple + corps Markdown.
 * Module pur, sans accès disque : partagé par le chargeur, l'installateur et les profils d'agents.
 */

/** Nom de skill : minuscules, chiffres et tirets. */
export function slugifySkillName(raw: string): string {
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// ============================================================================
// FORMAT SKILL.md
// ============================================================================

/** Retire les guillemets YAML : « \" » et « \\ » entre doubles, « '' » entre simples. */
const unquote = (v: string) => {
  const t = v.trim();
  const m = /^(["'])([\s\S]*)\1$/.exec(t);
  if (!m) return t;
  return m[1] === '"' ? m[2].replace(/\\(["\\])/g, '$1') : m[2].replace(/''/g, "'");
};

/**
 * Lit le frontmatter YAML des clés simples (name, description, license…), y compris
 * les blocs multi-lignes « > » et « | » et les valeurs qui continuent à la ligne suivante.
 * Une liste « - item » devient une valeur séparée par des espaces ; un objet imbriqué
 * (metadata:) est ignoré sans erreur.
 */
export function parseFrontmatter(yaml: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1].toLowerCase();
    let value = m[2].trim();
    const block = /^([>|])[+-]?$/.exec(value);
    if (block || value === '') {
      // Bloc indenté : « > » replie les lignes, « | » les garde
      const parts: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        parts.push(lines[++i].trim());
      }
      if (!block && parts.some((p) => /^[\w-]+\s*:/.test(p))) continue; // objet imbriqué (metadata:)
      if (!block && parts.length && parts.filter(Boolean).every((p) => p.startsWith('- '))) {
        meta[key] = parts.filter(Boolean).map((p) => unquote(p.slice(2))).join(' ');
        continue;
      }
      value = block?.[1] === '|' ? parts.join('\n').trim() : parts.filter(Boolean).join(' ');
    } else {
      // Valeur simple qui continue sur des lignes indentées
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s+[\w-]+\s*:/.test(lines[i + 1])) {
        value += ' ' + lines[++i].trim();
      }
    }
    meta[key] = unquote(value);
  }
  return meta;
}

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
  license?: string;
  /** Outils pré-approuvés déclarés par la skill (champ `allowed-tools`, expérimental dans la spec). */
  allowedTools?: string[];
}

/** Découpe une liste d'outils « Read Bash(git:*) Write » en entrées, parenthèses comprises. */
export function parseToolList(raw: string | undefined): string[] {
  if (!raw) return [];
  return (raw.match(/[^\s,()]+(?:\([^)]*\))?/g) || []).map((t) => t.trim()).filter(Boolean).slice(0, 50);
}

export function parseSkill(markdown: string, fallbackName: string): ParsedSkill {
  const text = markdown.replace(/^﻿/, '');
  const fm = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  const meta = fm ? parseFrontmatter(fm[1]) : {};
  const body = (fm ? text.slice(fm[0].length) : text).trim();
  const firstLine = body.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') || '';
  return {
    name: slugifySkillName(meta.name || fallbackName) || slugifySkillName(fallbackName) || 'skill',
    description: (meta.description || firstLine).replace(/\s+/g, ' ').slice(0, 500),
    body,
    license: meta.license,
    ...(meta['allowed-tools'] ? { allowedTools: parseToolList(meta['allowed-tools']) } : {}),
  };
}

export function serializeSkill(skill: { name: string; description: string; body: string }): string {
  const desc = skill.description.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `---\nname: ${skill.name}\ndescription: "${desc}"\n---\n\n${skill.body.trim()}\n`;
}
