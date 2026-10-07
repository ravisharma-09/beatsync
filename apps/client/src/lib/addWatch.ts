/**
 * Watches an "add to queue" request. The server answers either by changing the queue or with
 * a notice. If neither arrives, the request was lost (the connection dropped, or the server
 * was restarting) and the person must be told, not left looking at a tick.
 */
export const ADD_REPLY_TIMEOUT_MS = 12_000;

let lastNoticeAt = 0;

/** Called whenever the server sends this user a notice. */
export const noteServerNotice = (): void => {
  lastNoticeAt = Date.now();
};

/**
 * Calls `onLost` if, after the timeout, the queue has not grown and no notice came.
 * `getQueueLength` reads the current queue length.
 */
export function watchAdd(getQueueLength: () => number, onLost: () => void): void {
  const sentAt = Date.now();
  const lengthBefore = getQueueLength();
  setTimeout(() => {
    if (getQueueLength() > lengthBefore || lastNoticeAt >= sentAt) return;
    onLost();
  }, ADD_REPLY_TIMEOUT_MS);
}
