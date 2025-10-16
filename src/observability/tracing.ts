import { Attributes, SpanStatusCode, trace } from '@opentelemetry/api';

type SpanAttributes = Record<string, string | number | boolean | undefined>;

export function withSpan<T>(name: string, attributes: SpanAttributes | undefined, fn: () => Promise<T>): Promise<T> {
  const tracer = trace.getTracer('repo-tokenizer');
  const attrs: Attributes | undefined = attributes
    ? Object.fromEntries(
        Object.entries(attributes).filter((entry): entry is [string, string | number | boolean] =>
          entry[1] !== undefined,
        ),
      )
    : undefined;

  return new Promise<T>((resolve, reject) => {
    tracer.startActiveSpan(name, { attributes: attrs }, (span) => {
      fn()
        .then((result) => {
          span.setStatus({ code: SpanStatusCode.OK });
          resolve(result);
        })
        .catch((error) => {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
          reject(error);
        })
        .finally(() => {
          span.end();
        });
    });
  });
}
