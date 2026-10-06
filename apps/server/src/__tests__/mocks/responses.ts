import { mock } from "bun:test";

/**
 * Other test files replace "@/utils/responses" with stubs that return empty responses, and
 * module mocks are shared by the whole test run. Tests that read HTTP status codes and
 * bodies call this to get working response helpers regardless of which file ran first.
 */
export function mockResponsesWithRealHttp(): void {
  void mock.module("@/utils/responses", () => ({
    corsHeaders: {},
    jsonResponse: (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }),
    errorResponse: (message: string, status = 400) => new Response(message, { status }),
    sendBroadcast: mock(() => {
      /* noop */
    }),
    sendUnicast: mock(() => {
      /* noop */
    }),
    sendToClient: mock(() => {
      /* noop */
    }),
  }));
}
