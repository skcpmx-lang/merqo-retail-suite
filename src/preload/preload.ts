import { contextBridge, ipcRenderer } from 'electron';

export interface InvokeResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

contextBridge.exposeInMainWorld('merqo', {
  invoke: (action: string, args?: Record<string, unknown>, token?: string): Promise<InvokeResult> =>
    ipcRenderer.invoke('merqo:invoke', action, args ?? {}, token),
  dialog: (kind: string, options?: Record<string, unknown>): Promise<InvokeResult> =>
    ipcRenderer.invoke('merqo:dialog', kind, options ?? {}),
  shell: (action: string, target: string): Promise<InvokeResult> =>
    ipcRenderer.invoke('merqo:shell', action, target),
  printers: (): Promise<InvokeResult> => ipcRenderer.invoke('merqo:printers'),
  print: (payload: Record<string, unknown>): Promise<InvokeResult> => ipcRenderer.invoke('merqo:print', payload),
  pdf: (payload: Record<string, unknown>): Promise<InvokeResult> => ipcRenderer.invoke('merqo:pdf', payload),
  preview: (payload: Record<string, unknown>): Promise<InvokeResult> => ipcRenderer.invoke('merqo:preview', payload),
  version: '1.0.0',
});
