import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHostBridge } from '../src/host/bridge.ts';
import { BROWSER_HOST_FEATURES, type HostCommand, type HostEvent } from '../src/host/contracts.ts';
import { dispatchHostEvent, subscribeToWindowHostEvents } from '../src/host/windowEvents.ts';

function createWindowMessageEvent(data: unknown): Event {
  const event = new Event('message') as Event & { data?: unknown };
  Object.defineProperty(event, 'data', {
    configurable: true,
    enumerable: true,
    value: data,
  });
  return event;
}

test('createHostBridge forwards commands and host events', () => {
  const sentCommands: HostCommand[] = [];
  let emitHostEvent: ((event: HostEvent) => void) | undefined;

  const bridge = createHostBridge({
    runtime: 'browser',
    features: BROWSER_HOST_FEATURES,
    postMessage(message) {
      sentCommands.push(message);
    },
    subscribe(listener) {
      emitHostEvent = listener;
      return () => {
        emitHostEvent = undefined;
      };
    },
  });

  const receivedEvents: HostEvent[] = [];
  const unsubscribe = bridge.subscribe((event) => {
    receivedEvents.push(event);
  });

  bridge.postMessage({ type: 'setSoundEnabled', enabled: true });
  emitHostEvent?.({ type: 'layoutLoaded', layout: null });

  assert.deepEqual(sentCommands, [{ type: 'setSoundEnabled', enabled: true }]);
  assert.deepEqual(receivedEvents, [{ type: 'layoutLoaded', layout: null }]);

  unsubscribe();
  emitHostEvent?.({ type: 'agentClosed', id: 7 });
  assert.equal(receivedEvents.length, 1);
});

test('subscribeToWindowHostEvents listens to window messages and custom host events', () => {
  const target = new EventTarget();
  const receivedEvents: HostEvent[] = [];

  const unsubscribe = subscribeToWindowHostEvents(target, (event) => {
    receivedEvents.push(event);
  });

  target.dispatchEvent(createWindowMessageEvent({ type: 'agentStatus', id: 1, status: 'active' }));
  dispatchHostEvent(target, { type: 'agentClosed', id: 1 });

  unsubscribe();
  target.dispatchEvent(
    createWindowMessageEvent({ type: 'agentClosed', id: 2 } satisfies HostEvent),
  );

  assert.deepEqual(receivedEvents, [
    { type: 'agentStatus', id: 1, status: 'active' },
    { type: 'agentClosed', id: 1 },
  ]);
});
