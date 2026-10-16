/**
 * WebSocket adapter for CollabTransport (browser and Tauri webview).
 * One frame per WebSocket message; JSON encoded protocol v1.
 */

import type { ClientMessage } from './protocol';
import type { CollabTransport } from './syncEngine';

export class WebSocketCollabTransport implements CollabTransport {
  private socket: WebSocket | null = null;
  private readonly openHandlers: Array<() => void> = [];
  private readonly frameHandlers: Array<(data: string) => void> = [];
  private readonly disconnectHandlers: Array<() => void> = [];

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.socket) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      for (const handler of this.openHandlers) handler();
    };
    socket.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : '';
      if (data) for (const handler of this.frameHandlers) handler(data);
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      for (const handler of this.disconnectHandlers) handler();
    };
    socket.onerror = () => {
      // onclose follows in every browser engine; nothing else to do here.
    };
  }

  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    // 1000 (normal closure): the leave is intentional; prevents the host
    // from treating it as an abnormal drop.
    socket?.close(1000, 'leave');
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  onFrame(handler: (data: string) => void): void {
    this.frameHandlers.push(handler);
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }
}
