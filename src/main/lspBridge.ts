import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { ipcMain } from 'electron';

const servers = new Map<string, ChildProcessWithoutNullStreams>();

export function startLanguageServer(id: string, command: string, args: string[], sender: Electron.WebContents) {
  const proc = spawn(command, args);
  servers.set(id, proc);
  proc.stdout.on('data', (chunk) => sender.send(`lsp:${id}:message`, chunk.toString()));
  proc.stderr.on('data', (chunk) => console.error(`[lsp:${id}]`, chunk.toString()));
  ipcMain.on(`lsp:${id}:send`, (_e, message: string) => proc.stdin.write(message));
}

export function stopLanguageServer(id: string) {
  servers.get(id)?.kill();
  servers.delete(id);
}
