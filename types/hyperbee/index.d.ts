declare module 'hyperbee' {
  type Hypercore = import('hypercore')

  declare class Batch {
    async put (key: string, value: any)
    async del (key: string)
    async flush ()
  }

  export default class HyperBee {
    constructor(feed: any, opts?: {});
    keyEncoding: any;
    valueEncoding: any;
    sep: any;
    readonly: boolean;
    prefix: any;
    get feed(): Hypercore;
    ready(): Promise<vid>;
    get version(): number;
    update(): any;
    peek(opts: any): Promise<any>;
    createReadStream(opts?: any): any;
    createHistoryStream(opts?: any): any;
    createDiffStream(right: any, opts?: any): any;
    get(key: any, opts?: any): Promise<any>;
    put(key: any, value: any, opts?: any): Promise<void>;
    batch(opts?: any): Batch;
    del(key: any, opts?: any): Promise<void>;
    checkout(version: any): HyperBee;
    snapshot(): HyperBee;
    sub(prefix: any, opts?: {}): HyperBee;
  }
  interface BlockEntry {
    seq: any;
    key: any;
    value: any;
  }
}