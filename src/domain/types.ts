export interface LicenseRuleConfig {
  allowed?: string[];
  denied?: string[];
  defaultAction?: 'allow' | 'deny';
}

export interface PiiRuleConfig {
  enabled?: boolean;
  replacement?: string;
  patterns?: string[];
}

export interface DomainConfig {
  license?: LicenseRuleConfig;
  pii?: PiiRuleConfig;
}

export type DomainAction = 'allow' | 'deny';

export interface DomainFinding {
  path: string;
  type: 'license' | 'pii';
  message: string;
  details?: Record<string, unknown>;
}

export interface DomainEvaluationInput {
  path: string;
  content: string;
  language?: string;
}

export interface DomainEvaluationResult {
  action: DomainAction;
  content: string;
  findings: DomainFinding[];
}
