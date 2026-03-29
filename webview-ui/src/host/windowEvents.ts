import { HOST_MESSAGE_EVENT, type HostEvent } from './contracts.js';

export interface WindowHostEventSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent?(event: Event): boolean;
}

export function readHostEvent(payload: unknown): HostEvent | null {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'type' in payload &&
    typeof (payload as { type?: unknown }).type === 'string'
  ) {
    return payload as HostEvent;
  }

  return null;
}

export function subscribeToWindowHostEvents(
  source: WindowHostEventSource,
  listener: (message: HostEvent) => void,
): () => void {
  const handleWindowMessage = (event: Event) => {
    const message = readHostEvent((event as Event & { data?: unknown }).data);
    if (message) {
      listener(message);
    }
  };

  const handleCustomMessage = (event: Event) => {
    const message = readHostEvent((event as Event & { detail?: unknown }).detail);
    if (message) {
      listener(message);
    }
  };

  source.addEventListener('message', handleWindowMessage);
  source.addEventListener(HOST_MESSAGE_EVENT, handleCustomMessage);

  return () => {
    source.removeEventListener('message', handleWindowMessage);
    source.removeEventListener(HOST_MESSAGE_EVENT, handleCustomMessage);
  };
}

export function dispatchHostEvent(source: WindowHostEventSource, event: HostEvent): void {
  if (!source.dispatchEvent) {
    return;
  }

  source.dispatchEvent(new CustomEvent<HostEvent>(HOST_MESSAGE_EVENT, { detail: event }));
}
