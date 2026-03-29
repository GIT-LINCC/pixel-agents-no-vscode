import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DesktopHostApi, HostCommand, HostEvent } from '../src/host/contracts.ts';
import { createHostBridgeForRuntime } from '../src/host/index.ts';
import { detectRuntime } from '../src/runtime.ts';

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

test('createHostBridgeForRuntime selects the correct host provider', () => {
  const desktopBridge = createHostBridgeForRuntime('desktop', desktopHostStub);
  const browserBridge = createHostBridgeForRuntime('browser');

  assert.equal(desktopBridge.runtime, 'desktop');
  assert.equal(desktopBridge.features.launchAgents, false);
  assert.equal(browserBridge.runtime, 'browser');
  assert.equal(browserBridge.features.launchAgents, false);
});
