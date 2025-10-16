import { IndexChunk, IndexResult } from '../indexer/types';

export interface RecommendationOptions {
  limit?: number;
  maxTokens?: number;
}

export interface RecommendedChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  tokenCount?: number;
  preview: string;
}

export interface ContextRecommendation {
  label: string;
  reason: string;
  score: number;
  chunks: RecommendedChunk[];
}

function toRecommendedChunk(chunk: IndexChunk, previewLength = 200): RecommendedChunk {
  return {
    id: chunk.id,
    path: chunk.metadata.path,
    startLine: chunk.metadata.startLine,
    endLine: chunk.metadata.endLine,
    tokenCount: chunk.metadata.tokenCount,
    preview: chunk.text.slice(0, previewLength),
  };
}

export function buildRecommendations(index: IndexResult, options: RecommendationOptions = {}): ContextRecommendation[] {
  const limit = options.limit ?? 5;
  const maxTokens = options.maxTokens ?? Number.MAX_SAFE_INTEGER;
  const filteredChunks = index.chunks.filter((chunk) => (chunk.metadata.tokenCount ?? chunk.text.length) <= maxTokens);

  if (filteredChunks.length === 0) {
    return [];
  }

  const recommendations: ContextRecommendation[] = [];

  const largest = [...filteredChunks]
    .sort((a, b) => (b.metadata.tokenCount ?? b.text.length) - (a.metadata.tokenCount ?? a.text.length))
    .slice(0, limit)
    .map((chunk) => toRecommendedChunk(chunk));
  recommendations.push({
    label: 'High complexity',
    reason: 'Largest chunks by token count',
    score: 0.8,
    chunks: largest,
  });

  if (index.secretFindings.length > 0) {
    const secretChunks: RecommendedChunk[] = [];
    index.secretFindings.forEach((finding) => {
      const chunk = filteredChunks.find(
        (candidate) =>
          candidate.metadata.path === finding.path &&
          finding.line >= candidate.metadata.startLine &&
          finding.line <= candidate.metadata.endLine,
      );
      if (chunk) {
        secretChunks.push(toRecommendedChunk(chunk));
      }
    });
    if (secretChunks.length > 0) {
      recommendations.push({
        label: 'Secret findings',
        reason: 'Chunks containing detected secrets',
        score: 1,
        chunks: secretChunks.slice(0, limit),
      });
    }
  }

  if (index.domainFindings && index.domainFindings.length > 0) {
    const policyChunks: RecommendedChunk[] = [];
    index.domainFindings.forEach((finding) => {
      const chunk = filteredChunks.find((candidate) => candidate.metadata.path === finding.path);
      if (chunk) {
        policyChunks.push(toRecommendedChunk(chunk));
      }
    });
    if (policyChunks.length > 0) {
      recommendations.push({
        label: 'Policy review',
        reason: 'Chunks affected by licence/PII policies',
        score: 0.6,
        chunks: policyChunks.slice(0, limit),
      });
    }
  }

  const languageBuckets = new Map<string, RecommendedChunk[]>();
  filteredChunks.forEach((chunk) => {
    const language = index.fileLanguageByHash[chunk.fileHash]?.toLowerCase() ?? 'unknown';
    const bucket = languageBuckets.get(language) ?? [];
    bucket.push(toRecommendedChunk(chunk));
    languageBuckets.set(language, bucket);
  });

  const languageRecommendations = Array.from(languageBuckets.entries()).map(([language, bucket]) => {
    const top = bucket.slice(0, Math.min(limit, bucket.length));
    return {
      label: `Language focus: ${language}`,
      reason: `Representative chunks for ${language}`,
      score: 0.5,
      chunks: top,
    } satisfies ContextRecommendation;
  });
  recommendations.push(...languageRecommendations);

  return recommendations;
}
