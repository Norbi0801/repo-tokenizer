import {
  DomainConfig,
  DomainEvaluationInput,
  DomainEvaluationResult,
  DomainFinding,
} from './types';
import { LicenseEvaluator } from './license';
import { PiiAnonymizer } from './pii';

interface EngineDependencies {
  licenseEvaluator: LicenseEvaluator;
  piiAnonymizer: PiiAnonymizer;
}

export class DomainPolicyEngine {
  private readonly deps: EngineDependencies;

  constructor(private readonly config: DomainConfig = {}) {
    this.deps = {
      licenseEvaluator: new LicenseEvaluator(config.license),
      piiAnonymizer: new PiiAnonymizer(config.pii),
    };
  }

  evaluate(input: DomainEvaluationInput): DomainEvaluationResult {
    let content = input.content;
    const findings: DomainFinding[] = [];

    const licenseResult = this.deps.licenseEvaluator.evaluate(input.path, content);
    findings.push(...licenseResult.findings);
    if (licenseResult.action === 'deny') {
      return {
        action: 'deny',
        content,
        findings,
      };
    }

    const piiResult = this.deps.piiAnonymizer.anonymize(input.path, content);
    content = piiResult.content;
    findings.push(...piiResult.findings);

    return {
      action: 'allow',
      content,
      findings,
    };
  }
}
