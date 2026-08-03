from pathlib import Path

protocol = Path('apps/gateway/src/openai/protocol.ts')
text = protocol.read_text()
old = "    model: typeof value.model === 'string' ? value.model : requestedModel,"
assert text.count(old) == 1
text = text.replace(old, '    model: requestedModel,', 1)
old = """export function normalizeChatCompletionChunk(
  value: unknown,
): Readonly<Record<string, unknown>> {"""
new = """export function normalizeChatCompletionChunk(
  value: unknown,
  requestedModel?: string,
): Readonly<Record<string, unknown>> {"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = """    object:
      typeof value.object === 'string' ? value.object : 'chat.completion.chunk',
    choices: value.choices,"""
new = """    object:
      typeof value.object === 'string' ? value.object : 'chat.completion.chunk',
    ...(requestedModel !== undefined ? { model: requestedModel } : {}),
    choices: value.choices,"""
assert text.count(old) == 1
protocol.write_text(text.replace(old, new, 1))

sse = Path('apps/gateway/src/openai/sse.ts')
text = sse.read_text()
old = 'export function canonicalizeChatSseData(data: string): CanonicalSseEvent {'
new = """export function canonicalizeChatSseData(
  data: string,
  requestedModel?: string,
): CanonicalSseEvent {"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = '  const chunk = normalizeChatCompletionChunk(parsed);'
assert text.count(old) == 1
sse.write_text(text.replace(old, '  const chunk = normalizeChatCompletionChunk(parsed, requestedModel);', 1))

client = Path('apps/gateway/src/openai/client.ts')
text = client.read_text()
old = """export interface ProviderRequestContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
}"""
new = """export interface ProviderRequestContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly publicModel?: string;
}"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = """function canonicalEvents(
  dataEvents: readonly string[],
  state: { done: boolean },
): readonly CanonicalSseEvent[] {"""
new = """function canonicalEvents(
  dataEvents: readonly string[],
  state: { done: boolean },
  requestedModel: string,
): readonly CanonicalSseEvent[] {"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = '    const event = canonicalizeChatSseData(data);'
assert text.count(old) == 1
text = text.replace(old, '    const event = canonicalizeChatSseData(data, requestedModel);', 1)
old = """async function prepareStreamingBody(
  response: Response,
  context: ProviderRequestContext,
  scope: AbortScope,
): Promise<Readable> {"""
new = """async function prepareStreamingBody(
  response: Response,
  context: ProviderRequestContext,
  scope: AbortScope,
  responseModel: string,
): Promise<Readable> {"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
text = text.replace('canonicalEvents(decoder.finish(), state)', 'canonicalEvents(decoder.finish(), state, responseModel)')
text = text.replace("""canonicalEvents(
        decoder.push(byteChunk(chunk.value)),
        state,
      )""", """canonicalEvents(
        decoder.push(byteChunk(chunk.value)),
        state,
        responseModel,
      )""")
text = text.replace("""canonicalEvents(
            decoder.push(byteChunk(chunk.value)),
            state,
          )""", """canonicalEvents(
            decoder.push(byteChunk(chunk.value)),
            state,
            responseModel,
          )""")
old = """    try {
      const response = await fetch(
        endpoint(this.config.baseUrl, 'chat/completions'),"""
new = """    try {
      const responseModel = context.publicModel ?? request.model;
      const response = await fetch(
        endpoint(this.config.baseUrl, 'chat/completions'),"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = '        const body = await prepareStreamingBody(response, context, scope);'
new = """        const body = await prepareStreamingBody(
          response,
          context,
          scope,
          responseModel,
        );"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = """        parseJson(text, 'Upstream returned malformed chat completion JSON'),
        request.model,"""
new = """        parseJson(text, 'Upstream returned malformed chat completion JSON'),
        responseModel,"""
assert text.count(old) == 1
client.write_text(text.replace(old, new, 1))

provider = Path('apps/gateway/src/routing/provider.ts')
text = provider.read_text()
old = '              { requestId: context.requestId, signal },'
new = """              {
                requestId: context.requestId,
                signal,
                publicModel: request.model,
              },"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
marker = "const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;"
comparator = """const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

function compareIdentifier(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}"""
assert text.count(marker) == 1
text = text.replace(marker, comparator, 1)
old = '.sort((left, right) => left.id.localeCompare(right.id))'
assert text.count(old) == 1
provider.write_text(text.replace(old, '.sort((left, right) => compareIdentifier(left.id, right.id))', 1))

test = Path('apps/gateway/test/routed-gateway.test.ts')
text = test.read_text()
old = "    expect(response.statusCode).toBe(200);\n    expect(primary.requests[0]?.model).toBe('primary-upstream');"
new = "    expect(response.statusCode).toBe(200);\n    expect(response.json()).toMatchObject({ model: 'tony-auto' });\n    expect(response.body).not.toContain('backup-upstream');\n    expect(primary.requests[0]?.model).toBe('primary-upstream');"
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = """        'data: {\"id\":\"chunk\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\\n\\n',"""
new = """        'data: {\"id\":\"chunk\",\"model\":\"backup-upstream\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\\n\\n',"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = """    expect(response.body).toContain('\"content\":\"ok\"');"""
new = """    expect(response.body).toContain('\"content\":\"ok\"');
    expect(response.body).toContain('\"model\":\"tony-auto\"');
    expect(response.body).not.toContain('backup-upstream');"""
assert text.count(old) == 1
test.write_text(text.replace(old, new, 1))
