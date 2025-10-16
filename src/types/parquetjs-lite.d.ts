declare module 'parquetjs-lite' {
  import { Writable } from 'stream';

  export class ParquetSchema {
    constructor(schema: Record<string, any>);
  }

  export class ParquetWriter {
    static openFile(schema: ParquetSchema, path: string): Promise<ParquetWriter>;
    static openStream(schema: ParquetSchema, stream: Writable): Promise<ParquetWriter>;
    appendRow(row: Record<string, any>): Promise<void>;
    close(): Promise<void>;
  }
}
