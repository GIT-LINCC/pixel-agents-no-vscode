import type * as vscode from 'vscode';

import type { HostEvent } from '../shared/host/types.js';

export function postHostEvent(webview: vscode.Webview | undefined, event: HostEvent): void {
  void webview?.postMessage(event);
}
