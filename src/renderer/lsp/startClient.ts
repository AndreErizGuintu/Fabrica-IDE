import { MonacoLanguageClient } from 'monaco-languageclient';
import { CloseAction, ErrorAction } from 'vscode-languageclient';
import { IpcReader, IpcWriter } from './ipcTransport';

export function startClient(id: string, languageId: string) {
  const client = new MonacoLanguageClient({
    name: `${languageId} language client`,
    clientOptions: {
      documentSelector: [languageId],
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: CloseAction.DoNotRestart }),
      },
    },
    connectionProvider: {
      get: () => Promise.resolve({ reader: new IpcReader(id), writer: new IpcWriter(id) }),
    },
  });
  client.start();
}
