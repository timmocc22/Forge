import { ServiceUnavailableException } from '@nestjs/common';

export class TaskCapacityError extends ServiceUnavailableException {}

/** Admission and shutdown shared by generation and conversation requests. */
export class ProjectTasks {
  private readonly controllers = new Map<string, AbortController>();
  private closing = false;
  hasCapacity() {
    return !this.closing && this.controllers.size < 2;
  }
  assertAvailable(message: string) {
    if (this.closing || this.controllers.size >= 2) throw new TaskCapacityError(message);
  }
  register(id: string) {
    this.assertAvailable('当前模型任务较多，请稍后重试');
    if (this.controllers.has(id)) throw new Error('任务标识已注册');
    const controller = new AbortController();
    this.controllers.set(id, controller);
    return controller;
  }
  get(id: string) {
    return this.controllers.get(id);
  }
  release(id: string) {
    this.controllers.delete(id);
  }
  close() {
    this.closing = true;
    for (const controller of this.controllers.values()) controller.abort();
  }
}
