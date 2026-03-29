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

export function getDesktopHost(): DesktopHostApi | undefined {
  return (globalThis as typeof globalThis & { window?: { pixelAgentsHost?: DesktopHostApi } })
    .window?.pixelAgentsHost;
}

export function hasVsCodeApi(): boolean {
  return typeof acquireVsCodeApi !== 'undefined';
}

export function detectRuntime(options?: {
  hasDesktopHost?: boolean;
  hasVsCodeApi?: boolean;
}): Runtime {
  if (options?.hasDesktopHost) {
    return 'desktop';
  }

  if (options?.hasVsCodeApi) {
    return 'vscode';
  }

  return 'browser';
}

export function getRuntime(): Runtime {
  return detectRuntime({
    hasDesktopHost: Boolean(getDesktopHost()),
    hasVsCodeApi: hasVsCodeApi(),
  });
}

export function isBrowserRuntime(): boolean {
  return getRuntime() === 'browser';
}

export function isDesktopRuntime(): boolean {
  return getRuntime() === 'desktop';
}
