import { AbstractMessageReader, AbstractMessageWriter, DataCallback, Message } from 'vscode-jsonrpc';

export class IpcReader extends AbstractMessageReader {
  private buffer = '';
  constructor(private id: string) { super(); }
  listen(callback: DataCallback) {
    window.lsp.onMessage(this.id, (chunk) => {
      this.buffer += chunk;
      while (true) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const match = /Content-Length: (\d+)/.exec(this.buffer.slice(0, headerEnd));
        if (!match) break;
        const length = parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        if (this.buffer.length < bodyStart + length) break;
        callback(JSON.parse(this.buffer.slice(bodyStart, bodyStart + length)) as Message);
        this.buffer = this.buffer.slice(bodyStart + length);
      }
    });
    return { dispose: () => {} };
  }
}

export class IpcWriter extends AbstractMessageWriter {
  constructor(private id: string) { super(); }
  write(msg: Message): Promise<void> {
    const json = JSON.stringify(msg);
    window.lsp.send(this.id, `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
    return Promise.resolve();
  }
  end() {}
}
