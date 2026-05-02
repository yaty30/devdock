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
    exec: (source: string) => void;
    prepare: (source: string) => Statement;
    pragma: (source: string) => unknown;
  };

  const DatabaseConstructor: {
    new (
      path: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ): Database;
  };

  export default DatabaseConstructor;
}
