import { ModelError } from "./providers.js";
interface Task {
  priority: number;
  run(): Promise<void>;
  signal: AbortSignal;
  reject(error: unknown): void;
}
interface Lane {
  active: number;
  limit: number;
  waiting: Task[];
}
/** A connection's concurrency budget is shared by every tab and processing surface. */
export class RequestScheduler {
  private lanes = new Map<string, Lane>();
  schedule(
    key: string,
    limit: number,
    priority: number,
    signal: AbortSignal,
    run: () => Promise<void>,
  ): Promise<void> {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { active: 0, limit, waiting: [] };
      this.lanes.set(key, lane);
    }
    lane.limit = limit;
    const current = lane;
    return new Promise((resolve, reject) => {
      const task: Task = {
        priority,
        signal,
        reject,
        run: async () => {
          try {
            await run();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      };
      const abort = () => {
        const at = current.waiting.indexOf(task);
        if (at >= 0) {
          current.waiting.splice(at, 1);
          reject(new ModelError("cancelled"));
          this.pump(key, current);
        }
      };
      if (signal.aborted) {
        reject(new ModelError("cancelled"));
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      const original = task.run;
      task.run = async () => {
        signal.removeEventListener("abort", abort);
        await original();
      };
      current.waiting.push(task);
      current.waiting.sort((a, b) => a.priority - b.priority);
      // Let the current processing turn enqueue and prioritise its complete set before dispatch.
      queueMicrotask(() => this.pump(key, current));
    });
  }
  private pump(key: string, lane: Lane): void {
    while (lane.active < lane.limit && lane.waiting.length) {
      const task = lane.waiting.shift()!;
      if (task.signal.aborted) {
        task.reject(new ModelError("cancelled"));
        continue;
      }
      lane.active++;
      void task.run().finally(() => {
        lane.active--;
        this.pump(key, lane);
      });
    }
    if (!lane.active && !lane.waiting.length && this.lanes.get(key) === lane)
      this.lanes.delete(key);
  }
}
