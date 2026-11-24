/** Enter submits on a keyboard; touch keyboards retain Enter for new lines. */
export function composerSubmitKey(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    isComposing?: boolean;
    keyCode?: number;
  },
  touch: boolean,
) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    (!touch || event.ctrlKey || event.metaKey)
  );
}
/** Batches share one queue; a failed batch must not block the next upload. */
export function attachmentQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task);
    tail = next.catch(() => undefined);
    return next;
  };
}
