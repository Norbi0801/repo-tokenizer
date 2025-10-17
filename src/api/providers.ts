import type { GitProviderKind } from '../integrations';

export function normalizeProviderKind(value?: string): GitProviderKind | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'github' || normalized === 'gitlab') {
    return normalized as GitProviderKind;
  }
  return undefined;
}
