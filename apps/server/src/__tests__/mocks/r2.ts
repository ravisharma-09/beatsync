import { mock } from "bun:test";

/**
 * Default R2 mock that stubs all external R2 operations as no-ops.
 * Call `mockR2()` at the top of your test file (before any imports that use R2).
 *
 * For custom overrides, pass a partial map:
 * ```ts
 * mockR2({ downloadJSON: mock(() => myData) })
 * ```
 */
export function mockR2(overrides: Record<string, ReturnType<typeof mock>> = {}): void {
  const defaults: Record<string, ReturnType<typeof mock>> = {
    deleteObjectsWithPrefix: mock(() => ({ deletedCount: 0 })),
    uploadJSON: mock(() => {
      /* noop */
    }),
    downloadJSON: mock(() => null),
    getLatestFileWithPrefix: mock(() => null),
    getSortedFilesWithPrefix: mock(() => []),
    deleteObject: mock(() => {
      /* noop */
    }),
    validateAudioFileExists: mock(() => true),
    cleanupOrphanedRooms: mock(() => ({
      orphanedRooms: [],
      totalRooms: 0,
      totalFiles: 0,
    })),

    // Per-user library storage. The fake bucket is served from https://cdn.test/.
    validateR2Config: mock(() => ({ isValid: true, errors: [] })),
    objectExists: mock(() => true),
    copyObject: mock(() => {
      /* noop */
    }),
    generatePresignedUserUploadUrl: mock(() => "https://upload.test/signed"),
    createUserKey: mock((userId: string, fileName: string) => `user-${userId}/${fileName}`),
    isUserKey: mock((key: string, userId: string) => key.startsWith(`user-${userId}/`)),
    getPublicUrlForKey: mock((key: string) => `https://cdn.test/${key}`),
    extractOwnKeyFromUrl: mock((url: string) =>
      url.startsWith("https://cdn.test/") ? decodeURIComponent(url.slice("https://cdn.test/".length)) : null
    ),
    titleFromFileName: mock((fileName: string) => fileName.split("___")[0]),
  };

  // Start from the real module so exports that are not stubbed here (pure helpers like
  // createKey) still exist. Without this, whichever test file runs first decides which
  // exports every later file can import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be synchronous: callers mock before importing
  const actual = require("@/lib/r2") as Record<string, unknown>;

  void mock.module("@/lib/r2", () => ({ ...actual, ...defaults, ...overrides }));
}
