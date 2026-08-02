import { describe, expect, it } from 'vitest';

import { GatewayTelemetry } from '../src/telemetry.js';

describe('gateway telemetry', () => {
  it('records bounded request metadata without request bodies or query strings', () => {
    let now = Date.parse('2026-08-02T12:00:00.000Z');
    const telemetry = new GatewayTelemetry({ now: () => now, maxRecords: 2 });

    telemetry.start({
      requestId: 'request-1',
      method: 'POST',
      path: '/v1/chat/completions',
    });
    now += 125;
    telemetry.complete({ requestId: 'request-1', statusCode: 200 });

    const snapshot = telemetry.snapshot();
    expect(snapshot.requestsSinceStart).toBe(1);
    expect(snapshot.successfulRequestsSinceStart).toBe(1);
    expect(snapshot.successRate).toBe(100);
    expect(snapshot.inFlightRequests).toBe(0);
    expect(snapshot.recentRequests).toEqual([
      {
        requestId: 'request-1',
        method: 'POST',
        path: '/v1/chat/completions',
        statusCode: 200,
        startedAt: '2026-08-02T12:00:00.000Z',
        completedAt: '2026-08-02T12:00:00.125Z',
        durationMs: 125,
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('prompt');
    expect(JSON.stringify(snapshot)).not.toContain('authorization');
  });

  it('excludes health, UI assets, and the dashboard snapshot endpoint', () => {
    const telemetry = new GatewayTelemetry();
    const paths = [
      '/',
      '/health',
      '/ui',
      '/ui/',
      '/ui/styles.css',
      '/ui/app.js',
      '/ui/api/dashboard',
    ];

    paths.forEach((path, index) => {
      const requestId = `request-${index}`;
      telemetry.start({ requestId, method: 'GET', path });
      telemetry.complete({ requestId, statusCode: 200 });
    });

    expect(telemetry.snapshot()).toMatchObject({
      requestsSinceStart: 0,
      inFlightRequests: 0,
      recentRequests: [],
    });
  });

  it('tracks failures, in-flight requests, and enforces the record bound', () => {
    let now = 1_000;
    const telemetry = new GatewayTelemetry({ now: () => now, maxRecords: 2 });

    telemetry.start({
      requestId: 'in-flight',
      method: 'POST',
      path: '/v1/chat/completions',
    });
    telemetry.start({ requestId: 'one', method: 'GET', path: '/v1/models' });
    now += 10;
    telemetry.complete({ requestId: 'one', statusCode: 401 });
    telemetry.start({ requestId: 'two', method: 'GET', path: '/v1/models' });
    now += 10;
    telemetry.complete({ requestId: 'two', statusCode: 200 });
    telemetry.start({
      requestId: 'three',
      method: 'GET',
      path: '/v1/models',
    });
    now += 10;
    telemetry.complete({ requestId: 'three', statusCode: 503 });

    const snapshot = telemetry.snapshot();
    expect(snapshot.inFlightRequests).toBe(1);
    expect(snapshot.recentRequests).toHaveLength(2);
    expect(snapshot.recentRequests.map((record) => record.requestId)).toEqual([
      'three',
      'two',
    ]);
    expect(snapshot.requestsSinceStart).toBe(3);
    expect(snapshot.successfulRequestsSinceStart).toBe(1);
    expect(snapshot.successRate).toBe(33.3);
  });

  it('rejects invalid record bounds', () => {
    expect(() => new GatewayTelemetry({ maxRecords: 0 })).toThrow(RangeError);
    expect(() => new GatewayTelemetry({ maxRecords: 10_001 })).toThrow(
      RangeError,
    );
    expect(() => new GatewayTelemetry({ maxRecords: 1.5 })).toThrow(RangeError);
  });
});
