import { WebSocketServer } from "ws";

export function createRawWebSocketServer(maxPayload: number): WebSocketServer {
  return new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    clientTracking: false,
    maxPayload,
  });
}
