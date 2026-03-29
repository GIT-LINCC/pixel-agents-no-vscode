/**
 * Runtime detection, provider-agnostic.
 *
 * This now distinguishes between VS Code, future desktop hosts, and plain
 * browser/dev runtimes without forcing the UI to know about any specific host
 * implementation details.
 */

import type { DesktopHostApi, HostRuntime } from '../../shared/host/types.ts';

declare global {
  interface Window {
    pixelAgentsHost?: DesktopHostApi;
  }
}

declare function acquireVsCodeApi(): unknown;

export type Runtime = HostRuntime;

export const runtime: Runtime =
  typeof window !== 'undefined' && window.pixelAgentsHost
    ? 'desktop'
    : typeof acquireVsCodeApi !== 'undefined'
      ? 'vscode'
      : 'browser';

export const isBrowserRuntime = runtime === 'browser';
export const isDesktopRuntime = runtime === 'desktop';
