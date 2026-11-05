/** Provider-neutral reasoning/action/observation loop. Adapters own wire messages. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export type ToolTurn = { kind: 'final'; value: unknown } | { kind: 'tools'; calls: ToolCall[] };
export async function runToolLoop(options: {
  signal: AbortSignal;
  maxCalls?: number;
  step(): Promise<ToolTurn>;
  execute(call: ToolCall): Promise<unknown>;
  observe(call: ToolCall, output: unknown): void;
}) {
  const limit = options.maxCalls ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid tool budget');
  let used = 0;
  const seen = new Set<string>();
  for (let round = 0; round <= limit; round++) {
    options.signal.throwIfAborted();
    const turn = await options.step();
    options.signal.throwIfAborted();
    if (turn.kind === 'final') return turn.value;
    if (!turn.calls.length || used + turn.calls.length > limit)
      throw new ToolLoopError('TOOL_LIMIT');
    // Validate the whole batch before any tool is invoked.
    const ids = turn.calls.map((call) => call.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => seen.has(id)))
      throw new ToolLoopError('DUPLICATE_TOOL_CALL');
    for (const call of turn.calls) {
      options.signal.throwIfAborted();
      seen.add(call.id);
      const output = await options.execute(call);
      options.signal.throwIfAborted();
      options.observe(call, output);
      used++;
    }
  }
  throw new ToolLoopError('TOOL_LIMIT');
}
export class ToolLoopError extends Error {
  constructor(readonly code: 'TOOL_LIMIT' | 'DUPLICATE_TOOL_CALL') {
    super(code);
  }
}
