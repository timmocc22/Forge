import { describe, expect, it, vi } from 'vitest';
import { runToolLoop } from './tool-loop.js';
const call = (id: string) => ({ id, name: 'read_scene', arguments: '{}' });
describe('provider-neutral tool execution', () => {
  it('executes actions, observes results and returns the final answer', async () => {
    const step = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'tools', calls: [call('1')] })
      .mockResolvedValueOnce({ kind: 'final', value: { answer: 'done' } });
    const observe = vi.fn();
    expect(
      await runToolLoop({
        signal: new AbortController().signal,
        step,
        execute: async () => 'page',
        observe,
      }),
    ).toEqual({ answer: 'done' });
    expect(observe).toHaveBeenCalledWith(call('1'), 'page');
  });
  it('rejects a duplicate call batch before executing any actions', async () => {
    const execute = vi.fn();
    await expect(
      runToolLoop({
        signal: new AbortController().signal,
        step: async () => ({ kind: 'tools', calls: [call('1'), call('1')] }),
        execute,
        observe() {},
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_TOOL_CALL' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not execute tools after cancellation while the model was responding', async () => {
    const controller = new AbortController();
    const execute = vi.fn();
    await expect(
      runToolLoop({
        signal: controller.signal,
        step: async () => {
          controller.abort();
          return { kind: 'tools', calls: [call('1')] };
        },
        execute,
        observe() {},
      }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
