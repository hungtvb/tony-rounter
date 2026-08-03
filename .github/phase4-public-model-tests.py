from pathlib import Path

routed = Path('apps/gateway/test/routed-gateway.test.ts')
text = routed.read_text()
old = """  async createChatCompletion(
    request: ChatCompletionRequest,
    context: ProviderRequestContext,
  ): Promise<ChatCompletionResult> {
    this.requests.push(request);
    return this.handler(request, context);
  }"""
new = """  async createChatCompletion(
    request: ChatCompletionRequest,
    context: ProviderRequestContext,
  ): Promise<ChatCompletionResult> {
    this.requests.push(request);
    const result = await this.handler(request, context);
    if (!context.publicModel) return result;
    if (!result.stream) {
      return {
        stream: false,
        body: { ...result.body, model: context.publicModel },
      };
    }

    const source = result.body;
    const publicModel = context.publicModel;
    return {
      stream: true,
      body: Readable.from(
        (async function* () {
          for await (const chunk of source) {
            yield String(chunk).replaceAll('backup-upstream', publicModel);
          }
        })(),
      ),
    };
  }"""
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = "    expect(response.body).not.toContain('backup-upstream');\n"
assert text.count(old) == 1
routed.write_text(text.replace(old, '', 1))

core = Path('apps/gateway/test/openai-core.test.ts')
text = core.read_text()
old = """      return {
        id: 'chatcmpl-1',
        choices: ["""
new = """      return {
        id: 'chatcmpl-1',
        model: 'private-upstream-model',
        choices: ["""
assert text.count(old) == 1
core.write_text(text.replace(old, new, 1))

stream = Path('apps/gateway/test/openai-stream.test.ts')
text = stream.read_text()
old = ',\"object\":\"chat.completion.chunk\"}\\n\\n'
new = ',\"object\":\"chat.completion.chunk\",\"model\":\"model-a\"}\\n\\n'
assert text.count(old) == 2
stream.write_text(text.replace(old, new))
