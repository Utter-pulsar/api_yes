// A typed command/query registry. Services register handlers here; the SAME registry
// is invoked from IPC (renderer). One invocation surface keeps the app scriptable.

export type ApiShape = Record<string, { input: unknown; result: unknown }>

export type Handler<I, R> = (input: I) => Promise<R> | R

export class Registry<ApiMap extends ApiShape> {
  private handlers = new Map<keyof ApiMap, Handler<unknown, unknown>>()

  register<K extends keyof ApiMap>(
    name: K,
    handler: Handler<ApiMap[K]['input'], ApiMap[K]['result']>
  ): void {
    if (this.handlers.has(name)) {
      throw new Error(`Registry: handler already registered for "${String(name)}"`)
    }
    this.handlers.set(name, handler as Handler<unknown, unknown>)
  }

  has(name: keyof ApiMap): boolean {
    return this.handlers.has(name)
  }

  names(): (keyof ApiMap)[] {
    return [...this.handlers.keys()]
  }

  async execute<K extends keyof ApiMap>(
    name: K,
    input: ApiMap[K]['input']
  ): Promise<ApiMap[K]['result']> {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`Registry: no handler for "${String(name)}"`)
    return (await handler(input)) as ApiMap[K]['result']
  }
}
