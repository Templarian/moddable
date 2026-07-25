declare module "embedded:io/socket/tcp/tls" {
  import { Options as TCPOptions } from "embedded:io/socket/tcp"
  export type Options = TCPOptions & {
    host: string
    secure: Record<string, any> // should be called "tls" according to std?
  }
  export default class TLSSocket {
    constructor(options: Options)
    close(): void
    read(count: number|ArrayBufferLike) : undefined|ArrayBufferLike
    write(buffer: ArrayBufferLike) : number
    set format(format: string)
    get format() : string
  }
  interface TLSSocket extends Disposable {}
}

