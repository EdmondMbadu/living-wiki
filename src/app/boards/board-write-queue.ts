/** Keep writes to the same board in the order the editor requested them. */
export class BoardWriteQueue {
  private readonly pending = new Map<string, Promise<unknown>>();

  run<T>(boardId: string, write: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(boardId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(write);
    this.pending.set(boardId, result);
    void result.finally(() => {
      if (this.pending.get(boardId) === result) this.pending.delete(boardId);
    }).catch(() => undefined);
    return result;
  }
}
