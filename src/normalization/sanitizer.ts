import { SanitizationOptions } from './types';

export class ContentSanitizer {
  constructor(private readonly options: SanitizationOptions) {}

  sanitize(text: string): { sanitized: string; appliedRules: string[] } {
    let result = text;
    const appliedRules: string[] = [];

    for (const rule of this.options.rules) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(result)) {
        result = result.replace(rule.pattern, rule.replacement);
        appliedRules.push(rule.id);
      }
    }

    return { sanitized: result, appliedRules };
  }
}
