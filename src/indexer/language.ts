const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cxx': 'C++',
  '.cc': 'C++',
  '.c': 'C',
  '.h': 'C',
  '.hpp': 'C++',
  '.hh': 'C++',
  '.scala': 'Scala',
  '.php': 'PHP',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'LESS',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.toml': 'TOML',
  '.md': 'Markdown',
  '.rst': 'reStructuredText',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.bat': 'Batch',
  '.ps1': 'PowerShell',
  '.dockerfile': 'Dockerfile',
  'dockerfile': 'Dockerfile',
  '.gradle': 'Groovy',
  '.groovy': 'Groovy',
  '.lua': 'Lua',
};

export function detectLanguageFromPath(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('/dockerfile')) {
    return 'Dockerfile';
  }
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex === -1) {
    return undefined;
  }
  const ext = lower.slice(dotIndex);
  return EXTENSION_LANGUAGE_MAP[ext];
}
