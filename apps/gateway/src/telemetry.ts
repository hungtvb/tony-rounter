const DEFAULT_MAX_RECORDS = 200;

export interface GatewayTelemetryOptions {
  readonly maxRecords?: number;
  readonly now?: () => number;
}

export interface GatewayRequestStart {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
}

export interface GatewayRequestCompletion {
  readonly requestId: string;
  readonly statusCode: number;
}

export interface GatewayRequestRecord {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface GatewayTelemetrySnapshot {
  readonly startedAt: string;
  readonly generatedAt: string;
  readonly uptimeMs: number;
  readonly requestsSinceStart: number;
  readonly successfulRequestsSinceStart: number;
  readonly successRate: number | null;
  readonly inFlightRequests: number;
  readonly recentRequests: readonly GatewayRequestRecord[];
}

interface ActiveRequest {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly startedAtMs: number;
}

interface StoredRequest extends ActiveRequest {
  readonly statusCode: number;
  readonly completedAtMs: number;
  readonly durationMs: number;
}

function shouldTrack(path: string): boolean {
  return !(
    path === '/' ||
    path === '/health' ||
    path === '/ui' ||
    path === '/ui/' ||
    path === '/ui/styles.css' ||
    path === '/ui/app.js' ||
    path === '/ui/api/dashboard'
  );
}

function roundRate(value: number): number {
  return Math.round(value * 10) / 10;
}

export class GatewayTelemetry {
  readonly #maxRecords: number;
  readonly #now: () => number;
  readonly #startedAtMs: number;
  readonly #active = new Map<string, ActiveRequest>();
  readonly #records: StoredRequest[] = [];
  #completedCount = 0;
  #successfulCount = 0;

  constructor(options: GatewayTelemetryOptions = {}) {
    const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 10_000) {
      throw new RangeError('maxRecords must be an integer between 1 and 10000');
    }

    this.#maxRecords = maxRecords;
    this.#now = options.now ?? Date.now;
    this.#startedAtMs = this.#now();
  }

  start(request: GatewayRequestStart): void {
    if (!shouldTrack(request.path)) return;

    this.#active.set(request.requestId, {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      startedAtMs: this.#now(),
    });
  }

  complete(completion: GatewayRequestCompletion): void {
    const active = this.#active.get(completion.requestId);
    if (!active) return;

    this.#active.delete(completion.requestId);
    const completedAtMs = this.#now();
    this.#completedCount += 1;
    if (completion.statusCode >= 200 && completion.statusCode < 400) {
      this.#successfulCount += 1;
    }

    this.#records.unshift({
      ...active,
      statusCode: completion.statusCode,
      completedAtMs,
      durationMs: Math.max(0, completedAtMs - active.startedAtMs),
    });

    if (this.#records.length > this.#maxRecords) {
      this.#records.length = this.#maxRecords;
    }
  }

  snapshot(): GatewayTelemetrySnapshot {
    const now = this.#now();
    return Object.freeze({
      startedAt: new Date(this.#startedAtMs).toISOString(),
      generatedAt: new Date(now).toISOString(),
      uptimeMs: Math.max(0, now - this.#startedAtMs),
      requestsSinceStart: this.#completedCount,
      successfulRequestsSinceStart: this.#successfulCount,
      successRate:
        this.#completedCount === 0
          ? null
          : roundRate((this.#successfulCount / this.#completedCount) * 100),
      inFlightRequests: this.#active.size,
      recentRequests: Object.freeze(
        this.#records.slice(0, 20).map((record) =>
          Object.freeze({
            requestId: record.requestId,
            method: record.method,
            path: record.path,
            statusCode: record.statusCode,
            startedAt: new Date(record.startedAtMs).toISOString(),
            completedAt: new Date(record.completedAtMs).toISOString(),
            durationMs: record.durationMs,
          }),
        ),
      ),
    });
  }
}
