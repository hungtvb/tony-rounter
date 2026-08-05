/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally implement asynchronous interfaces */

import { Writable } from 'node:stream';

import multipartPlugin from '@fastify/multipart';
import { parseRoutingConfig } from '@tony-router/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createJsonLogger,
  createNullLogger,
  type CanonicalDeletedFile,
  type CanonicalFileObject,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type GatewayConfig,
  GatewayHttpError,
  type OpenAICompatibleProvider,
  type ProviderFileUpload,
} from '../src/index.js';
import type { GatewayRouterConfig } from '../src/routing/config.js';
import { authorization, GATEWAY_TOKEN } from './helpers/openai-harness.js';

const FILE_ID_KEY = 'server-only-file-id-key-'.padEnd(48, 'f');
const apps: FastifyInstance[] = [];

const ROUTING_YAML = `version: 2
defaultProfile: tony-auto
providers:
  openai:
    kind: openai-compatible
accounts:
  personal:
    provider: openai
  work:
    provider: openai
models:
  gpt:
    provider: openai
    upstreamModel: gpt-5
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true
      fileInput: true
      structuredOutput: true
      contextTokens: 128000
routes:
  personal-route:
    model: gpt
    account: personal
    priority: 20
  work-route:
    model: gpt
    account: work
    priority: 10
profiles:
  tony-auto:
    routes:
      - route: personal-route
        priority: 20
      - route: work-route
        priority: 10
`;

function gatewayConfig(): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: GATEWAY_TOKEN,
    tokenFile: '/tmp/tony-router-files-token',
    tokenSource: 'environment',
    fileIdKey: FILE_ID_KEY,
    fileIdKeyFile: '/tmp/tony-router-files-key',
    fileIdKeySource: 'environment',
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 1000,
    shutdownGraceMs: 100,
    version: '0.2.0',
  };
}

function routerConfig(): GatewayRouterConfig {
  return {
    registry: parseRoutingConfig(ROUTING_YAML),
    providers: {
      openai: { baseUrl: 'https://api.openai.test/v1', timeoutMs: 500 },
    },
    accounts: {
      personal: {
        providerId: 'openai',
        baseUrl: 'https://api.openai.test/v1',
        timeoutMs: 500,
      },
      work: {
        providerId: 'openai',
        baseUrl: 'https://api.openai.test/v1',
        timeoutMs: 500,
      },
    },
    fallbackPolicy: {
      maxAttemptsPerRoute: 1,
      maxTotalAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      totalDeadlineMs: 1000,
    },
    circuitBreaker: {
      failureThreshold: 1,
      cooldownMs: 60_000,
      halfOpenMaxAttempts: 1,
    },
  };
}

class FileProvider implements OpenAICompatibleProvider {
  readonly uploads: ProviderFileUpload[] = [];
  readonly deletes: string[] = [];
  readonly requests: ChatCompletionRequest[] = [];
  failChat = false;

  constructor(private readonly name: string) {}

  async listModels() {
    return { object: 'list' as const, data: [] };
  }

  async createFile(upload: ProviderFileUpload): Promise<CanonicalFileObject> {
    this.uploads.push(upload);
    return {
      id: `file-upstream-${this.name}-${this.uploads.length}`,
      object: 'file',
      bytes: upload.bytes.byteLength,
      created_at: 1_700_000_000,
      filename: upload.filename,
      purpose: 'user_data',
    };
  }

  async deleteFile(fileId: string): Promise<CanonicalDeletedFile> {
    this.deletes.push(fileId);
    return { id: fileId, object: 'file', deleted: true };
  }

  async createChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResult> {
    this.requests.push(request);
    if (this.failChat) {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'credentials rejected',
      );
    }
    return {
      stream: false,
      body: {
        id: `chatcmpl-${this.name}`,
        object: 'chat.completion',
        model: request.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      },
    };
  }
}

function multipart(
  parts: readonly Readonly<{
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
  }>[],
): Readonly<{ payload: Buffer; contentType: string }> {
  const boundary = 'tony-router-test-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: ${disposition}\r\n${
          part.contentType ? `Content-Type: ${part.contentType}\r\n` : ''
        }\r\n`,
        'utf8',
      ),
      typeof part.value === 'string'
        ? Buffer.from(part.value, 'utf8')
        : part.value,
      Buffer.from('\r\n', 'utf8'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function uploadBody(purpose = 'user_data') {
  return multipart([
    { name: 'purpose', value: purpose },
    {
      name: 'file',
      value: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'),
      filename: 'spec.pdf',
      contentType: 'application/pdf',
    },
  ]);
}

function routedApp() {
  const personal = new FileProvider('personal');
  const work = new FileProvider('work');
  const app = buildGateway({
    config: gatewayConfig(),
    router: routerConfig(),
    routedAccounts: { personal, work },
    logger: createNullLogger(),
  });
  apps.push(app);
  return { app, personal, work };
}

async function upload(
  app: FastifyInstance,
  accountId: string,
  purpose = 'user_data',
) {
  const form = uploadBody(purpose);
  return app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: {
      ...authorization(),
      'x-tony-router-account': accountId,
      'content-type': form.contentType,
    },
    payload: form.payload,
  });
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('virtual Files API', () => {
  it('proxies direct uploads and deletion through the upstream Files API', async () => {
    let uploadedBytes = '';
    let deletedId = '';
    const upstream = Fastify();
    void upstream.register(multipartPlugin);
    upstream.post('/v1/files', async (request) => {
      expect(request.headers.authorization).toBe('Bearer upstream-secret');
      let purpose = '';
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          uploadedBytes = (await part.toBuffer()).toString('utf8');
          expect(part.filename).toBe('spec.pdf');
          continue;
        }
        if (part.fieldname === 'purpose') purpose = String(part.value);
      }
      expect(purpose).toBe('user_data');
      return {
        id: 'file-direct-upstream',
        object: 'file',
        bytes: Buffer.byteLength(uploadedBytes),
        created_at: 1_700_000_000,
        filename: 'spec.pdf',
        purpose: 'user_data',
      };
    });
    upstream.delete('/v1/files/:fileId', (request) => {
      expect(request.headers.authorization).toBe('Bearer upstream-secret');
      deletedId = (request.params as { fileId: string }).fileId;
      return { id: deletedId, object: 'file', deleted: true };
    });
    apps.push(upstream);
    await upstream.listen({ host: '127.0.0.1', port: 0 });
    const address = upstream.server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('Expected upstream TCP address');
    }

    const app = buildGateway({
      config: {
        ...gatewayConfig(),
        upstream: {
          baseUrl: `http://127.0.0.1:${address.port}`,
          apiKey: 'upstream-secret',
          timeoutMs: 500,
        },
      },
      logger: createNullLogger(),
    });
    apps.push(app);
    const form = uploadBody();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...authorization(), 'content-type': form.contentType },
      payload: form.payload,
    });

    expect(created.statusCode).toBe(200);
    const file = created.json<CanonicalFileObject>();
    expect(file.id).toMatch(/^file-tr-v1\./);
    expect(file.id).not.toContain('direct-upstream');
    expect(uploadedBytes).toBe('%PDF-1.4\n%%EOF\n');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/files/${file.id}`,
      headers: authorization(),
    });
    expect(deleted.statusCode).toBe(200);
    expect(deletedId).toBe('file-direct-upstream');
    expect(deleted.json()).toEqual({
      id: file.id,
      object: 'file',
      deleted: true,
    });
  });

  it('keeps virtual file IDs out of request logs and telemetry paths', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : typeof chunk === 'string'
            ? chunk
            : '';
        callback();
      },
    });
    const provider = new FileProvider('direct');
    const app = buildGateway({
      config: gatewayConfig(),
      provider,
      logger: createJsonLogger({ stream }),
    });
    apps.push(app);
    const form = uploadBody();
    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...authorization(), 'content-type': form.contentType },
      payload: form.payload,
    });
    const publicId = uploaded.json<CanonicalFileObject>().id;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/files/${publicId}`,
      headers: authorization(),
    });

    expect(deleted.statusCode).toBe(200);
    expect(output).not.toContain(publicId);
    expect(output).toContain('/v1/files/:fileId');
  });

  it('uploads to the explicit account and pins Responses routing to that owner', async () => {
    const { app, personal, work } = routedApp();
    const created = await upload(app, 'work');

    expect(created.statusCode).toBe(200);
    expect(created.headers['x-tony-router-account']).toBe('work');
    const file = created.json<CanonicalFileObject>();
    expect(file.id).toMatch(/^file-tr-v1\./);
    expect(file.id).not.toContain('work');
    expect(file.id).not.toContain('openai');
    expect(file.id).not.toContain('upstream');
    expect(personal.uploads).toHaveLength(0);
    expect(work.uploads).toHaveLength(1);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { ...authorization(), 'content-type': 'application/json' },
      payload: {
        model: 'tony-auto',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'Summarize' },
              { type: 'input_file', file_id: file.id },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-account']).toBe('work');
    expect(personal.requests).toHaveLength(0);
    expect(work.requests).toHaveLength(1);
    expect(work.requests[0]).toMatchObject({
      model: 'gpt-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Summarize' },
            {
              type: 'file',
              file: { file_id: 'file-upstream-work-1' },
            },
          ],
        },
      ],
    });
  });

  it('does not fall back to another account when the owning account fails', async () => {
    const { app, personal, work } = routedApp();
    const file = (await upload(app, 'work')).json<CanonicalFileObject>();
    work.failChat = true;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: {
        ...authorization(),
        'content-type': 'application/json',
        'x-tony-router-replay-safe': 'true',
      },
      payload: {
        model: 'tony-auto',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_file', file_id: file.id }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'no_compatible_route' },
    });
    expect(personal.requests).toHaveLength(0);
    expect(work.requests).toHaveLength(1);
  });

  it('rejects duplicate fields, duplicate files, and oversized uploads before provider invocation', async () => {
    const { app, personal, work } = routedApp();
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8');

    const duplicatePurpose = multipart([
      { name: 'purpose', value: 'user_data' },
      { name: 'purpose', value: 'user_data' },
      {
        name: 'file',
        value: pdf,
        filename: 'spec.pdf',
        contentType: 'application/pdf',
      },
    ]);
    const duplicateFieldResponse = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: {
        ...authorization(),
        'x-tony-router-account': 'work',
        'content-type': duplicatePurpose.contentType,
      },
      payload: duplicatePurpose.payload,
    });
    expect(duplicateFieldResponse.statusCode).toBe(400);
    expect(duplicateFieldResponse.json()).toMatchObject({
      error: { code: 'invalid_file_upload' },
    });

    const duplicateFiles = multipart([
      { name: 'purpose', value: 'user_data' },
      {
        name: 'file',
        value: pdf,
        filename: 'one.pdf',
        contentType: 'application/pdf',
      },
      {
        name: 'file',
        value: pdf,
        filename: 'two.pdf',
        contentType: 'application/pdf',
      },
    ]);
    const duplicateFileResponse = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: {
        ...authorization(),
        'x-tony-router-account': 'work',
        'content-type': duplicateFiles.contentType,
      },
      payload: duplicateFiles.payload,
    });
    expect(duplicateFileResponse.statusCode).toBe(400);
    expect(duplicateFileResponse.json()).toMatchObject({
      error: { code: 'invalid_file_upload' },
    });

    const oversized = multipart([
      { name: 'purpose', value: 'user_data' },
      {
        name: 'file',
        value: Buffer.alloc(16 * 1024 * 1024 + 1, 1),
        filename: 'large.bin',
        contentType: 'application/octet-stream',
      },
    ]);
    const oversizedResponse = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: {
        ...authorization(),
        'x-tony-router-account': 'work',
        'content-type': oversized.contentType,
      },
      payload: oversized.payload,
    });
    expect(oversizedResponse.statusCode).toBe(413);
    expect(oversizedResponse.json()).toMatchObject({
      error: { code: 'file_too_large' },
    });
    expect(personal.uploads).toHaveLength(0);
    expect(work.uploads).toHaveLength(0);
  });

  it('deletes only through the owning account', async () => {
    const { app, personal, work } = routedApp();
    const file = (await upload(app, 'work')).json<CanonicalFileObject>();

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/files/${file.id}`,
      headers: authorization(),
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({
      id: file.id,
      object: 'file',
      deleted: true,
    });
    expect(personal.deletes).toHaveLength(0);
    expect(work.deletes).toEqual(['file-upstream-work-1']);
  });

  it('rejects tampered and mixed-owner IDs before chat provider invocation', async () => {
    const { app, personal, work } = routedApp();
    const personalFile = (
      await upload(app, 'personal')
    ).json<CanonicalFileObject>();
    const workFile = (await upload(app, 'work')).json<CanonicalFileObject>();
    const tampered = `${workFile.id.slice(0, -1)}${workFile.id.endsWith('A') ? 'B' : 'A'}`;

    const tamperedResponse = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { ...authorization(), 'content-type': 'application/json' },
      payload: {
        model: 'tony-auto',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_file', file_id: tampered }],
          },
        ],
      },
    });
    expect(tamperedResponse.statusCode).toBe(400);
    expect(tamperedResponse.json()).toMatchObject({
      error: { code: 'invalid_file_id' },
    });

    const mixed = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { ...authorization(), 'content-type': 'application/json' },
      payload: {
        model: 'tony-auto',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_file', file_id: personalFile.id },
              { type: 'input_file', file_id: workFile.id },
            ],
          },
        ],
      },
    });
    expect(mixed.statusCode).toBe(400);
    expect(mixed.json()).toMatchObject({
      error: { code: 'mixed_file_ownership' },
    });
    expect(personal.requests).toHaveLength(0);
    expect(work.requests).toHaveLength(0);
  });

  it('requires authentication, an explicit routed account, and user_data purpose', async () => {
    const { app, personal, work } = routedApp();
    const form = uploadBody();
    const anonymous = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { 'content-type': form.contentType },
      payload: form.payload,
    });
    expect(anonymous.statusCode).toBe(401);

    const missingAccount = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...authorization(), 'content-type': form.contentType },
      payload: form.payload,
    });
    expect(missingAccount.statusCode).toBe(400);
    expect(missingAccount.json()).toMatchObject({
      error: { code: 'file_account_required' },
    });

    const wrongPurpose = await upload(app, 'work', 'assistants');
    expect(wrongPurpose.statusCode).toBe(400);
    expect(wrongPurpose.json()).toMatchObject({
      error: { code: 'unsupported_file_purpose' },
    });
    expect(personal.uploads).toHaveLength(0);
    expect(work.uploads).toHaveLength(0);
  });
});
