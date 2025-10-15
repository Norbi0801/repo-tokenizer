import { SecretFinding, SecretPattern } from './types';

const DEFAULT_PATTERNS: SecretPattern[] = [
  {
    id: 'aws-access-key',
    description: 'AWS access key',
    pattern: /(A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}/g,
  },
  {
    id: 'generic-bearer-token',
    description: 'Generic bearer token',
    pattern: /bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  },
  {
    id: 'private-key',
    description: 'Private key block',
    pattern: /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/g,
  },
  {
    id: 'api-key',
    description: 'API key assignment',
    pattern: /(api[_-]?key|secret|token)[\s:=]+['\"]?[A-Za-z0-9\-_.]{10,}['\"]?/gi,
  },
  {
    id: 'jwt',
    description: 'JSON Web Token',
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
];

export class SecretScanner {
  private readonly patterns: SecretPattern[];

  constructor(patterns: SecretPattern[] = DEFAULT_PATTERNS) {
    this.patterns = patterns;
  }

  scan(text: string, path: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const pattern of this.patterns) {
        pattern.pattern.lastIndex = 0;
        if (!pattern.pattern.test(line)) {
          continue;
        }
        findings.push({
          path,
          line: index + 1,
          ruleId: pattern.id,
          excerpt: line.trim().slice(0, 200),
        });
      }
    });

    return findings;
  }
}

export function mergeSecretPatterns(custom?: SecretPattern[]): SecretPattern[] {
  if (!custom || custom.length === 0) {
    return DEFAULT_PATTERNS;
  }
  const ids = new Set<string>();
  const merged: SecretPattern[] = [];
  for (const pattern of [...DEFAULT_PATTERNS, ...custom]) {
    if (ids.has(pattern.id)) {
      continue;
    }
    ids.add(pattern.id);
    merged.push(pattern);
  }
  return merged;
}
