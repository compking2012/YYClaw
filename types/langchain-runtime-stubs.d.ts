/**
 * Minimal stubs so `tsc` succeeds when optional `@langchain/*` packages are not installed.
 * Real package types take precedence when present in node_modules.
 */
declare module '@langchain/langgraph' {
  export const END: unique symbol;
  export const START: unique symbol;
  export class StateGraph {
    constructor(_schema: unknown);
    addNode(...args: unknown[]): this;
    addEdge(...args: unknown[]): this;
    addConditionalEdges(...args: unknown[]): this;
    compile(...args: unknown[]): unknown;
  }
  export class MemorySaver {
    constructor(...args: unknown[]);
    protected storage: Record<string, Record<string, Record<string, unknown[]>>>;
    protected writes: Record<string, Record<string, unknown[]>>;
    getTuple(config: { configurable?: { thread_id?: string } }): Promise<unknown>;
    put(config: { configurable?: { thread_id?: string } }, ...rest: unknown[]): Promise<unknown>;
    putWrites(config: { configurable?: { thread_id?: string } }, ...rest: unknown[]): Promise<unknown>;
    deleteThread(threadId: string): Promise<void>;
  }
  export class Command {
    constructor(...args: unknown[]);
  }
  interface AnnotationFn {
    <T>(config?: { reducer?: (left: T, right: T) => T; default?: () => T }): T;
    Root<S>(schema: S): { State: { -readonly [K in keyof S]: S[K] } };
  }
  export const Annotation: AnnotationFn;
  export function interrupt(...args: unknown[]): unknown;
  export class Send {
    constructor(...args: unknown[]);
  }
}

declare module '@langchain/core/runnables' {
  export type RunnableConfig = Record<string, unknown>;
}
