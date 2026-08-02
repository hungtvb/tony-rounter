const MAX_IDENTIFIER_LENGTH = 256;

function validateIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new RangeError(
      `${name} must contain between 1 and ${MAX_IDENTIFIER_LENGTH} characters`,
    );
  }
  return normalized;
}

export interface SessionAffinityStore {
  get(sessionId: string): string | undefined;
  remember(sessionId: string, routeId: string): void;
  forget(sessionId: string): void;
  clear(): void;
  readonly size: number;
}

export class InMemorySessionAffinityStore implements SessionAffinityStore {
  readonly #entries = new Map<string, string>();

  constructor(readonly maximumEntries = 10_000) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new RangeError('maximumEntries must be a positive safe integer');
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get(sessionId: string): string | undefined {
    const normalizedSessionId = validateIdentifier(sessionId, 'sessionId');
    const routeId = this.#entries.get(normalizedSessionId);
    if (routeId === undefined) return undefined;

    this.#entries.delete(normalizedSessionId);
    this.#entries.set(normalizedSessionId, routeId);
    return routeId;
  }

  remember(sessionId: string, routeId: string): void {
    const normalizedSessionId = validateIdentifier(sessionId, 'sessionId');
    const normalizedRouteId = validateIdentifier(routeId, 'routeId');

    this.#entries.delete(normalizedSessionId);
    this.#entries.set(normalizedSessionId, normalizedRouteId);

    while (this.#entries.size > this.maximumEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }

  forget(sessionId: string): void {
    this.#entries.delete(validateIdentifier(sessionId, 'sessionId'));
  }

  clear(): void {
    this.#entries.clear();
  }
}
