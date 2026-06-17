// Helper for Node environments where global WebSocket support is not available.
// Supabase Realtime needs a WebSocket constructor in Node.js when using @supabase/supabase-js.
let nodeRealtimeWebSocket: any | undefined;

if (typeof window === 'undefined' && typeof globalThis.WebSocket === 'undefined') {
  try {
    const wsModule = await import('ws');
    const ws = wsModule?.default ?? wsModule;
    if (ws) {
      nodeRealtimeWebSocket = ws;
      if (!globalThis.WebSocket) {
        (globalThis as any).WebSocket = ws;
      }
    }
  } catch (error) {
    console.warn('[Supabase] ws package not available; realtime transport may not work in Node 20:', error);
  }
}

export { nodeRealtimeWebSocket };
