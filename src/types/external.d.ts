declare module 'js-yaml' {
  const content: any;
  export = content;
}

declare module 'toml' {
  const content: any;
  export = content;
}

declare module 'sql.js' {
  export type SqlJsStatic = any;
  export type Database = any;
  const initSqlJs: (...args: any[]) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
