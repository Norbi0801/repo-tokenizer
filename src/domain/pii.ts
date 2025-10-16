import { PiiRuleConfig, DomainFinding } from './types';

const DEFAULT_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, // email
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, // SSN-like
  /\b(?:\+\d{1,3}\s?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/g, // phone
  /\b\d{13,16}\b/g, // credit card-ish
];

export class PiiAnonymizer {
  private readonly patterns: RegExp[];
  private readonly replacement: string;
  private readonly enabled: boolean;

  constructor(config: PiiRuleConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.replacement = config.replacement ?? '[pii]';
    this.patterns = (config.patterns ?? []).map((pattern) => new RegExp(pattern, 'gi')).concat(DEFAULT_PATTERNS);
  }

  anonymize(path: string, content: string): { content: string; findings: DomainFinding[] } {
    if (!this.enabled) {
      return { content, findings: [] };
    }

    let mutated = content;
    const findings: DomainFinding[] = [];
    this.patterns.forEach((pattern) => {
      mutated = mutated.replace(pattern, (match) => {
        findings.push({
          path,
          type: 'pii',
          message: `PII token redacted (${match.slice(0, 8)}${match.length > 8 ? '…' : ''})`,
        });
        return this.replacement;
      });
    });

    return { content: mutated, findings };
  }
}
