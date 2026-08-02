import type { Writable } from 'node:stream';

const SENSITIVE_KEY = /authorization|cookie|token|secret|password|api[-_]?key/i;

export interface JsonLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface JsonLoggerOptions {
  readonly stream?: Writable;
  readonly sensitiveValues?: readonly string[];
  readonly now?: () => Date;
}

function redactString(
  value: string,
  sensitiveValues: readonly string[],
): string {
  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length > 0) {
      redacted = redacted.split(sensitiveValue).join('[REDACTED]');
    }
  }
  return redacted;
}

function sanitize(
  value: unknown,
  sensitiveValues: readonly string[],
  seen: WeakSet<object>,
  key?: string,
): unknown {
  if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value, sensitiveValues);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[FUNCTION ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.description ?? '[SYMBOL]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, sensitiveValues),
      ...(value.stack
        ? { stack: redactString(value.stack, sensitiveValues) }
        : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, sensitiveValues, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = sanitize(entryValue, sensitiveValues, seen, entryKey);
    }
    return output;
  }
  return '[UNSERIALIZABLE]';
}

export function createJsonLogger(options: JsonLoggerOptions = {}): JsonLogger {
  const stream = options.stream ?? process.stdout;
  const sensitiveValues = options.sensitiveValues ?? [];
  const now = options.now ?? (() => new Date());

  const write = (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ): void => {
    const record = sanitize(
      {
        timestamp: now().toISOString(),
        level,
        message,
        ...context,
      },
      sensitiveValues,
      new WeakSet(),
    );
    stream.write(`${JSON.stringify(record)}\n`);
  };

  return {
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}

export function createNullLogger(): JsonLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}
