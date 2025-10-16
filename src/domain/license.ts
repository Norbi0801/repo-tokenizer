import { LicenseRuleConfig, DomainFinding } from './types';

const KNOWN_LICENSE_PATTERNS: Record<string, RegExp[]> = {
  MIT: [/permission\s+is\s+hereby\s+granted/i, /MIT\s+License/i],
  Apache2: [/apache\s+license,\s+version\s+2\.0/i, /http:\/\/www\.apache\.org\/licenses/i],
  GPL: [/gnu\s+general\s+public\s+license/i, /gpl\s+(v|version)\s?(\d+)/i],
  BSD: [/redistribution\s+and\s+use\s+in\s+source\s+and\s+binary\s+forms/i],
  MPL: [/mozilla\s+public\s+license/i],
};

export interface LicenseEvaluationResult {
  action: 'allow' | 'deny';
  license?: string;
  findings: DomainFinding[];
}

export class LicenseEvaluator {
  constructor(private readonly config: LicenseRuleConfig = {}) {}

  evaluate(path: string, content: string): LicenseEvaluationResult {
    const detected = this.detectLicense(content);
    if (!this.config.allowed && !this.config.denied && !detected) {
      return { action: 'allow', findings: [] };
    }

    const findings: DomainFinding[] = [];
    const defaultAction = this.config.defaultAction ?? 'allow';
    if (!detected) {
      return {
        action: defaultAction,
        findings,
      };
    }

    if (this.config.denied?.some((pattern) => pattern.toLowerCase() === detected.toLowerCase())) {
      findings.push({
        path,
        type: 'license',
        message: `Denied license detected: ${detected}`,
      });
      return { action: 'deny', license: detected, findings };
    }
    if (this.config.allowed && !this.config.allowed.some((license) => license.toLowerCase() === detected.toLowerCase())) {
      findings.push({
        path,
        type: 'license',
        message: `License ${detected} not in allow list`,
      });
      return { action: 'deny', license: detected, findings };
    }

    if (detected) {
      findings.push({
        path,
        type: 'license',
        message: `License accepted: ${detected}`,
      });
    }
    return { action: 'allow', license: detected, findings };
  }

  private detectLicense(content: string): string | undefined {
    const sample = content.slice(0, 4000);
    for (const [name, patterns] of Object.entries(KNOWN_LICENSE_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(sample))) {
        return name;
      }
    }
    return undefined;
  }
}
