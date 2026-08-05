/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally implement asynchronous interfaces */

import { request as httpRequest } from 'node:http';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import multipartPlugin from '@fastify/multipart';
import { parseRoutingConfig } from '@tony-router/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createJsonLogger,
  createNullLogger,
  type CanonicalDeletedFile,
  type CanonicalFileList,
  type CanonicalFileObject,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type GatewayConfig,
  GatewayHttpError,
  type OpenAICompatibleProvider,
  type ProviderFileContent,
  type ProviderFileListQuery,
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
  readonly lists: ProviderFileListQuery[] = [];
  readonly retrieves: string[] = [];
  readonly contentReads: string[] = [];
  readonly requests: ChatCompletionRequest[] = [];
  readonly files: CanonicalFileObject[] = [];
  failChat = false;

  constructor(private readonly name: string) {}

  async listModels() {
    return { object: 'list' as const, data: [] };
  }

  async createFile(upload: ProviderFileUpload): Promise<CanonicalFileObject> {
    this.uploads.push(upload);
    const file = Object.freeze({
      id: `file-upstream-${this.name}-${this.uploads.length}`,
      object: 'file' as const,
      bytes: upload.bytes.byteLength,
      created_at: 1_700_000_000 + this.uploads.length,
      filename: upload.filename,
      purpose: 'user_data' as const,
    });
    this.files.push(file);
    return file;
  }

  async listFiles(query: ProviderFileListQuery): Promise<CanonicalFileList> {
    this.lists.push(query);
    const ordered =
      query.order === 'asc' ? [...this.files] : [...this.files].reverse();
    const start = query.after
      ? Math.max(0, ordered.findIndex((file) => file.id === query.after) + 1)
      : 0;
    const data = Object.freeze(ordered.slice(start, start + query.limit));
    return Object.freeze({
      object: 'list' as const,
      data,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
      has_more: start + data.length < ordered.length,
    });
  }

  async retrieveFile(fileId: string): Promise<CanonicalFileObject> {
    this.retrieves.push(fileId);
    const file = this.files.find((item) => item.id === fileId);
    if (!file) {
      throw new GatewayHttpError(404, 'upstream_invalid_request', 'missing');
    }
    return file;
  }

  async retrieveFileContent(fileId: string): Promise<ProviderFileContent> {
    this.contentReads.push(fileId);
    if (!this.files.some((item) => item.id === fileId)) {
      throw new GatewayHttpError(404, 'upstream_invalid_request', 'missing');
    }
    return Object.freeze({
      bytes: Buffer.from(`content:${this.name}:${fileId}`, 'utf8'),
      contentType: 'application/pdf',
    });
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

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/files?limit=1',
      headers: authorization(),
    });
    const listedId = listed.json<CanonicalFileList>().data[0]!.id;
    const metadata = await app.inject({
      method: 'GET',
      url: `/v1/files/${listedId}`,
      headers: authorization(),
    });
    const content = await app.inject({
      method: 'GET',
      url: `/v1/files/${listedId}/content`,
      headers: authorization(),
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/files/${publicId}`,
      headers: authorization(),
    });

    expect(listed.statusCode).toBe(200);
    expect(metadata.statusCode).toBe(200);
    expect(content.statusCode).toBe(200);
    expect(deleted.statusCode).toBe(200);
    expect(output).not.toContain(publicId);
    expect(output).not.toContain(listedId);
    expect(output).not.toContain('file-upstream-direct-1');
    expect(output).not.toContain('content:direct:file-upstream-direct-1');
    expect(output).toContain('/v1/files/:fileId');
    expect(output).toContain('/v1/files/:fileId/content');
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

  it('lists, retrieves, and streams bounded content through the direct upstream', async () => {
    const files = [
      {
        id: 'file-direct-a',
        object: 'file' as const,
        bytes: 5,
        created_at: 1_700_000_001,
        filename: 'a.txt',
        purpose: 'user_data' as const,
      },
      {
        id: 'file-direct-b',
        object: 'file' as const,
        bytes: 5,
        created_at: 1_700_000_002,
        filename: 'b.txt',
        purpose: 'user_data' as const,
      },
    ];
    const listQueries: Readonly<Record<string, unknown>>[] = [];
    const retrieved: string[] = [];
    const contentReads: string[] = [];
    const upstream = Fastify();
    upstream.get('/v1/files', (request) => {
      const query = request.query as Readonly<Record<string, unknown>>;
      listQueries.push(query);
      const after = typeof query.after === 'string' ? query.after : undefined;
      const start = after
        ? Math.max(0, files.findIndex((file) => file.id === after) + 1)
        : 0;
      const limit =
        typeof query.limit === 'string' ? Number(query.limit) : 10_000;
      const data = files.slice(start, start + limit);
      return {
        object: 'list',
        data,
        first_id: data[0]?.id ?? null,
        last_id: data[data.length - 1]?.id ?? null,
        has_more: start + data.length < files.length,
      };
    });
    upstream.get('/v1/files/:fileId/content', (request, reply) => {
      const fileId = (request.params as { fileId: string }).fileId;
      contentReads.push(fileId);
      reply.header('content-type', 'text/plain; charset=utf-8');
      return reply.send(Buffer.from(`body:${fileId}`, 'utf8'));
    });
    upstream.get('/v1/files/:fileId', (request) => {
      const fileId = (request.params as { fileId: string }).fileId;
      retrieved.push(fileId);
      return files.find((file) => file.id === fileId);
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

    const firstPage = await app.inject({
      method: 'GET',
      url: '/v1/files?limit=1&order=asc&purpose=user_data',
      headers: authorization(),
    });
    expect(firstPage.statusCode).toBe(200);
    const firstList = firstPage.json<CanonicalFileList>();
    expect(firstList.data).toHaveLength(1);
    expect(firstList.data[0]?.id).toMatch(/^file-tr-v1\./);
    expect(firstList.data[0]?.id).not.toContain('direct-a');
    expect(firstList.has_more).toBe(true);

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/files?limit=1&order=asc&after=${encodeURIComponent(firstList.last_id!)}`,
      headers: authorization(),
    });
    expect(secondPage.statusCode).toBe(200);
    const secondList = secondPage.json<CanonicalFileList>();
    expect(secondList.data).toHaveLength(1);
    expect(listQueries[1]).toMatchObject({
      after: 'file-direct-a',
      limit: '1',
      order: 'asc',
      purpose: 'user_data',
    });

    const publicId = secondList.data[0]!.id;
    const metadata = await app.inject({
      method: 'GET',
      url: `/v1/files/${publicId}`,
      headers: authorization(),
    });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json<CanonicalFileObject>()).toMatchObject({
      id: publicId,
      filename: 'b.txt',
    });
    expect(retrieved).toEqual(['file-direct-b']);

    const content = await app.inject({
      method: 'GET',
      url: `/v1/files/${publicId}/content`,
      headers: authorization(),
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('text/plain');
    expect(content.rawPayload.toString('utf8')).toBe('body:file-direct-b');
    expect(contentReads).toEqual(['file-direct-b']);
  });

  it('keeps routed listing, metadata, content, and pagination on the explicit owner account', async () => {
    const { app, personal, work } = routedApp();
    await upload(app, 'work');
    await upload(app, 'work');

    const firstPage = await app.inject({
      method: 'GET',
      url: '/v1/files?limit=1&order=asc',
      headers: { ...authorization(), 'x-tony-router-account': 'work' },
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.headers['x-tony-router-account']).toBe('work');
    const listed = firstPage.json<CanonicalFileList>();
    expect(listed.data).toHaveLength(1);
    expect(personal.lists).toHaveLength(0);
    expect(work.lists).toEqual([
      { limit: 1, order: 'asc', purpose: 'user_data' },
    ]);

    const publicId = listed.data[0]!.id;
    const metadata = await app.inject({
      method: 'GET',
      url: `/v1/files/${publicId}`,
      headers: authorization(),
    });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.headers['x-tony-router-account']).toBe('work');
    expect(metadata.json<CanonicalFileObject>().id).toBe(publicId);
    expect(work.retrieves).toEqual(['file-upstream-work-1']);
    expect(personal.retrieves).toHaveLength(0);

    const content = await app.inject({
      method: 'GET',
      url: `/v1/files/${publicId}/content`,
      headers: authorization(),
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['x-tony-router-account']).toBe('work');
    expect(content.rawPayload.toString('utf8')).toBe(
      'content:work:file-upstream-work-1',
    );
    expect(work.contentReads).toEqual(['file-upstream-work-1']);
    expect(personal.contentReads).toHaveLength(0);

    const nextPage = await app.inject({
      method: 'GET',
      url: `/v1/files?limit=1&order=asc&after=${encodeURIComponent(listed.last_id!)}`,
      headers: { ...authorization(), 'x-tony-router-account': 'work' },
    });
    expect(nextPage.statusCode).toBe(200);
    expect(work.lists[1]).toEqual({
      after: 'file-upstream-work-1',
      limit: 1,
      order: 'asc',
      purpose: 'user_data',
    });

    const wrongOwner = await app.inject({
      method: 'GET',
      url: `/v1/files?after=${encodeURIComponent(listed.last_id!)}`,
      headers: { ...authorization(), 'x-tony-router-account': 'personal' },
    });
    expect(wrongOwner.statusCode).toBe(400);
    expect(wrongOwner.json()).toMatchObject({
      error: { code: 'invalid_file_id' },
    });
    expect(personal.lists).toHaveLength(0);
  });

  it('rejects missing routed account, duplicate or invalid list query values, and tampered read IDs before provider invocation', async () => {
    const { app, personal, work } = routedApp();
    const file = (await upload(app, 'work')).json<CanonicalFileObject>();

    const missingAccount = await app.inject({
      method: 'GET',
      url: '/v1/files',
      headers: authorization(),
    });
    expect(missingAccount.statusCode).toBe(400);
    expect(missingAccount.json()).toMatchObject({
      error: { code: 'file_account_required' },
    });

    for (const url of [
      '/v1/files?limit=0',
      '/v1/files?limit=10001',
      '/v1/files?limit=1&limit=2',
      '/v1/files?order=newest',
      '/v1/files?purpose=assistants',
      '/v1/files?unknown=value',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { ...authorization(), 'x-tony-router-account': 'work' },
      });
      expect(response.statusCode).toBe(400);
    }

    const tampered = `${file.id.slice(0, -1)}${file.id.endsWith('A') ? 'B' : 'A'}`;
    const metadata = await app.inject({
      method: 'GET',
      url: `/v1/files/${tampered}`,
      headers: authorization(),
    });
    const content = await app.inject({
      method: 'GET',
      url: `/v1/files/${tampered}/content`,
      headers: authorization(),
    });
    expect(metadata.statusCode).toBe(400);
    expect(content.statusCode).toBe(400);
    expect(personal.retrieves).toHaveLength(0);
    expect(work.retrieves).toHaveLength(0);
    expect(personal.contentReads).toHaveLength(0);
    expect(work.contentReads).toHaveLength(0);
  });

  it('fails closed when the configured provider does not implement file read operations', async () => {
    const uploads: ProviderFileUpload[] = [];
    const provider: OpenAICompatibleProvider = {
      async listModels() {
        return { object: 'list' as const, data: [] };
      },
      async createFile(upload: ProviderFileUpload) {
        uploads.push(upload);
        return {
          id: 'file-upload-delete-only',
          object: 'file' as const,
          bytes: upload.bytes.byteLength,
          created_at: 1,
          filename: upload.filename,
          purpose: 'user_data' as const,
        };
      },
      async deleteFile(fileId: string) {
        return { id: fileId, object: 'file' as const, deleted: true as const };
      },
      async createChatCompletion(request: ChatCompletionRequest) {
        return {
          stream: false as const,
          body: {
            id: 'chatcmpl-upload-delete-only',
            object: 'chat.completion',
            model: request.model,
            choices: [],
          },
        };
      },
    };
    const app = buildGateway({
      config: gatewayConfig(),
      provider,
      logger: createNullLogger(),
    });
    apps.push(app);

    const form = uploadBody();
    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...authorization(), 'content-type': form.contentType },
      payload: form.payload,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploads).toHaveLength(1);
    const publicId = uploaded.json<CanonicalFileObject>().id;

    for (const url of [
      '/v1/files',
      `/v1/files/${publicId}`,
      `/v1/files/${publicId}/content`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: authorization(),
      });
      expect(response.statusCode).toBe(501);
      expect(response.json()).toMatchObject({
        error: { code: 'files_api_not_supported' },
      });
    }
  });

  it('rejects file-list redirects and maps file-list idle timeout without contacting redirect targets', async () => {
    let targetCalls = 0;
    const target = Fastify();
    target.get('/v1/files', () => {
      targetCalls += 1;
      return {
        object: 'list',
        data: [],
        first_id: null,
        last_id: null,
        has_more: false,
      };
    });
    apps.push(target);
    await target.listen({ host: '127.0.0.1', port: 0 });
    const targetAddress = target.server.address();
    if (typeof targetAddress !== 'object' || targetAddress === null) {
      throw new Error('Expected redirect target TCP address');
    }

    const redirecting = Fastify();
    redirecting.get('/v1/files', (_request, reply) =>
      reply.redirect(`http://127.0.0.1:${targetAddress.port}/v1/files`),
    );
    apps.push(redirecting);
    await redirecting.listen({ host: '127.0.0.1', port: 0 });
    const redirectAddress = redirecting.server.address();
    if (typeof redirectAddress !== 'object' || redirectAddress === null) {
      throw new Error('Expected redirecting upstream TCP address');
    }

    const redirectApp = buildGateway({
      config: {
        ...gatewayConfig(),
        upstream: {
          baseUrl: `http://127.0.0.1:${redirectAddress.port}`,
          apiKey: 'redirect-secret',
          timeoutMs: 500,
        },
      },
      logger: createNullLogger(),
    });
    apps.push(redirectApp);
    const redirected = await redirectApp.inject({
      method: 'GET',
      url: '/v1/files',
      headers: authorization(),
    });
    expect(redirected.statusCode).toBe(502);
    expect(redirected.json()).toMatchObject({
      error: { code: 'upstream_connection_error' },
    });
    expect(targetCalls).toBe(0);

    const slow = Fastify();
    slow.get('/v1/files', async () => {
      await delay(80);
      return {
        object: 'list',
        data: [],
        first_id: null,
        last_id: null,
        has_more: false,
      };
    });
    apps.push(slow);
    await slow.listen({ host: '127.0.0.1', port: 0 });
    const slowAddress = slow.server.address();
    if (typeof slowAddress !== 'object' || slowAddress === null) {
      throw new Error('Expected slow upstream TCP address');
    }
    const timeoutApp = buildGateway({
      config: {
        ...gatewayConfig(),
        upstream: {
          baseUrl: `http://127.0.0.1:${slowAddress.port}`,
          timeoutMs: 10,
        },
      },
      logger: createNullLogger(),
    });
    apps.push(timeoutApp);
    const timedOut = await timeoutApp.inject({
      method: 'GET',
      url: '/v1/files',
      headers: authorization(),
    });
    expect(timedOut.statusCode).toBe(504);
    expect(timedOut.json()).toMatchObject({
      error: { code: 'upstream_timeout' },
    });
  });

  it('aborts an upstream file-content download when the downstream client disconnects', async () => {
    let resolveContentStarted: (() => void) | undefined;
    let resolveUpstreamClosed: (() => void) | undefined;
    const contentStarted = new Promise<void>((resolve) => {
      resolveContentStarted = resolve;
    });
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve;
    });
    const upstream = Fastify();
    upstream.get('/v1/files', () => ({
      object: 'list',
      data: [
        {
          id: 'file-disconnect',
          object: 'file',
          bytes: 128,
          created_at: 1,
          filename: 'disconnect.bin',
          purpose: 'user_data',
        },
      ],
      first_id: 'file-disconnect',
      last_id: 'file-disconnect',
      has_more: false,
    }));
    upstream.get('/v1/files/:fileId/content', (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'application/octet-stream' });
      resolveContentStarted?.();
      const timer = setInterval(() => {
        reply.raw.write(Buffer.alloc(64, 1));
      }, 10);
      reply.raw.once('close', () => {
        clearInterval(timer);
        resolveUpstreamClosed?.();
      });
    });
    apps.push(upstream);
    await upstream.listen({ host: '127.0.0.1', port: 0 });
    const upstreamAddress = upstream.server.address();
    if (typeof upstreamAddress !== 'object' || upstreamAddress === null) {
      throw new Error('Expected upstream TCP address');
    }

    const app = buildGateway({
      config: {
        ...gatewayConfig(),
        upstream: {
          baseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
          timeoutMs: 1000,
        },
      },
      logger: createNullLogger(),
    });
    apps.push(app);
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/files',
      headers: authorization(),
    });
    const publicId = listed.json<CanonicalFileList>().data[0]!.id;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const gatewayAddress = app.server.address();
    if (typeof gatewayAddress !== 'object' || gatewayAddress === null) {
      throw new Error('Expected gateway TCP address');
    }

    const downstream = httpRequest({
      host: '127.0.0.1',
      port: gatewayAddress.port,
      path: `/v1/files/${encodeURIComponent(publicId)}/content`,
      method: 'GET',
      headers: authorization(),
    });
    downstream.on('error', () => undefined);
    downstream.end();
    await contentStarted;
    downstream.destroy();

    await expect(
      Promise.race([
        upstreamClosed,
        delay(500).then(() => {
          throw new Error('Upstream file-content connection remained open');
        }),
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects malformed lists, mismatched metadata, unsafe content types, and oversized content from the upstream', async () => {
    const malformedUpstream = Fastify();
    malformedUpstream.get('/v1/files', () => ({
      object: 'list',
      data: [
        {
          id: 'file-a',
          object: 'file',
          bytes: 1,
          created_at: 1,
          filename: 'a.txt',
          purpose: 'user_data',
        },
      ],
      first_id: 'file-wrong',
      last_id: 'file-a',
      has_more: false,
    }));
    apps.push(malformedUpstream);
    await malformedUpstream.listen({ host: '127.0.0.1', port: 0 });
    const malformedAddress = malformedUpstream.server.address();
    if (typeof malformedAddress !== 'object' || malformedAddress === null) {
      throw new Error('Expected upstream TCP address');
    }
    const malformedApp = buildGateway({
      config: {
        ...gatewayConfig(),
        upstream: {
          baseUrl: `http://127.0.0.1:${malformedAddress.port}`,
          timeoutMs: 500,
        },
      },
      logger: createNullLogger(),
    });
    apps.push(malformedApp);
    const malformedList = await malformedApp.inject({
      method: 'GET',
      url: '/v1/files',
      headers: authorization(),
    });
    expect(malformedList.statusCode).toBe(502);
    expect(malformedList.json()).toMatchObject({
      error: { code: 'upstream_invalid_response' },
    });

    const files = [
      {
        id: 'file-metadata',
        object: 'file',
        bytes: 1,
        created_at: 1,
        filename: 'metadata.txt',
        purpose: 'user_data',
      },
      {
        id: 'file-content-type',
        object: 'file',
        bytes: 1,
        created_at: 2,
        filename: 'type.txt',
        purpose: 'user_data',
      },
      {
        id: 'file-large',
        object: 'file',
        bytes: 1,
        created_at: 3,
        filename: 'large.bin',
        purpose: 'user_data',
      },
    ];
    const unsafeUpstream = Fastify();
    unsafeUpstream.get('/v1/files', () => ({
      object: 'list',
      data: files,
      first_id: files[0]!.id,
      last_id: files[files.length - 1]!.id,
      has_more: false,
    }));
    unsafeUpstream.get('/v1/files/:fileId/content', (request, reply) => {
      const fileId = (request.params as { fileId: string }).fileId;
      if (fileId === 'file-content-type') {
        reply.header('content-type', 'text/plain; charset');
        return reply.send(Buffer.from('unsafe', 'utf8'));
      }
      reply.header('content-type', 'application/octet-stream');
      return reply.send(Buffer.alloc(16 * 1024 * 1024 + 1, 1));
    });
    unsafeUpstream.get('/v1/files/:fileId', (request) => {
      const fileId = (request.params as { fileId: string }).fileId;
      const file = files.find((item) => item.id === fileId)!;
      return { ...file, id: 'file-other' };
    });
    apps.push(unsafeUpstream);
    await unsafeUpstream.listen({ host: '127.0.0.1', port: 0 });
    const unsafeAddress = unsafeUpstream.server.address();
    if (typeof unsafeAddress !== 'object' || unsafeAddress === null) {
      throw new Error('Expected upstream TCP address');
    }
    const unsafeApp = buildGateway({
      config: {
        ...gatewayConfig(),
        upstream: {
          baseUrl: `http://127.0.0.1:${unsafeAddress.port}`,
          timeoutMs: 500,
        },
      },
      logger: createNullLogger(),
    });
    apps.push(unsafeApp);
    const listed = await unsafeApp.inject({
      method: 'GET',
      url: '/v1/files?order=asc',
      headers: authorization(),
    });
    expect(listed.statusCode).toBe(200);
    const publicFiles = listed.json<CanonicalFileList>().data;

    const mismatched = await unsafeApp.inject({
      method: 'GET',
      url: `/v1/files/${publicFiles[0]!.id}`,
      headers: authorization(),
    });
    expect(mismatched.statusCode).toBe(502);
    expect(mismatched.json()).toMatchObject({
      error: { code: 'upstream_invalid_response' },
    });

    const unsafeType = await unsafeApp.inject({
      method: 'GET',
      url: `/v1/files/${publicFiles[1]!.id}/content`,
      headers: authorization(),
    });
    expect(unsafeType.statusCode).toBe(502);
    expect(unsafeType.json()).toMatchObject({
      error: { code: 'upstream_invalid_response' },
    });

    const oversized = await unsafeApp.inject({
      method: 'GET',
      url: `/v1/files/${publicFiles[2]!.id}/content`,
      headers: authorization(),
    });
    expect(oversized.statusCode).toBe(502);
    expect(oversized.json()).toMatchObject({
      error: { code: 'upstream_response_too_large' },
    });
  });
});
