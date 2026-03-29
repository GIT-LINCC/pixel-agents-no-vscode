import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DesktopHostApi, HostCommand, HostEvent } from '../src/host/contracts.ts';
import { createHostBridgeForRuntime } from '../src/host/index.ts';
import { detectRuntime, getRuntime } from '../src/runtime.ts';

const desktopHostStub: DesktopHostApi = {
  features: {
    launchAgents: false,
    focusAgents: false,
    closeAgents: false,
    diagnostics: true,
    openSessionsFolder: false,
    importExportLayout: false,
    externalAssets: false,
  },
  postMessage(_message: HostCommand) {},
  subscribe(_listener: (message: HostEvent) => void) {
    return () => undefined;
  },
};

test('detectRuntime prefers desktop host over vscode and browser fallbacks', () => {
  assert.equal(detectRuntime({ hasDesktopHost: true, hasVsCodeApi: true }), 'desktop');
  assert.equal(detectRuntime({ hasDesktopHost: false, hasVsCodeApi: true }), 'vscode');
  assert.equal(detectRuntime({ hasDesktopHost: false, hasVsCodeApi: false }), 'browser');
});

test('getRuntime reads the current host environment on demand', () => {
  const originalWindow = Reflect.get(globalThis as object, 'window');
  const hadWindow = Reflect.has(globalThis as object, 'window');
  const originalAcquire = Reflect.get(globalThis as object, 'acquireVsCodeApi');
  const hadAcquire = Reflect.has(globalThis as object, 'acquireVsCodeApi');

  try {
    Reflect.set(globalThis as object, 'window', { pixelAgentsHost: desktopHostStub });
    Reflect.set(globalThis as object, 'acquireVsCodeApi', () => desktopHostStub);
    assert.equal(getRuntime(), 'desktop');

    Reflect.set(globalThis as object, 'window', {});
    assert.equal(getRuntime(), 'vscode');

    Reflect.deleteProperty(globalThis as object, 'acquireVsCodeApi');
    assert.equal(getRuntime(), 'browser');
  } finally {
    if (hadWindow) {
      Reflect.set(globalThis as object, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis as object, 'window');
    }

    if (hadAcquire) {
      Reflect.set(globalThis as object, 'acquireVsCodeApi', originalAcquire);
    } else {
      Reflect.deleteProperty(globalThis as object, 'acquireVsCodeApi');
    }
  }
});

test('createHostBridgeForRuntime selects the correct host provider', () => {
  const desktopBridge = createHostBridgeForRuntime('desktop', desktopHostStub);
  const browserBridge = createHostBridgeForRuntime('browser');

  assert.equal(desktopBridge.runtime, 'desktop');
  assert.equal(desktopBridge.features.launchAgents, false);
  assert.equal(browserBridge.runtime, 'browser');
  assert.equal(browserBridge.features.launchAgents, false);
});
