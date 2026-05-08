declare module "better-sqlite3" {
  export type RunResult = {
    changes: number;
    lastInsertRowid: number | bigint;
  };

  export type Statement = {
    run: (...params: unknown[]) => RunResult;
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };

  export type Database = {
    close: () => void;
    exec: (source: string) => void;
    prepare: (source: string) => Statement;
    pragma: (source: string) => unknown;
    transaction: <T extends (...args: never[]) => unknown>(fn: T) => T;
  };

  const DatabaseConstructor: {
    new (
      path: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ): Database;
  };

  export default DatabaseConstructor;
}
