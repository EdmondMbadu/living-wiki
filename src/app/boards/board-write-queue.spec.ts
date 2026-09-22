import { BoardWriteQueue } from './board-write-queue';

describe('BoardWriteQueue', () => {
  it('writes changes to one board in request order', async () => {
    const queue = new BoardWriteQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.run('board', async () => {
      order.push('first starts');
      await firstGate;
      order.push('first ends');
    });
    const second = queue.run('board', async () => { order.push('second'); });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['first starts']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first starts', 'first ends', 'second']);
  });

  it('continues after a failed write and does not block another board', async () => {
    const queue = new BoardWriteQueue();
    const failed = queue.run('board', async () => { throw new Error('offline'); });
    const next = queue.run('board', async () => 'saved');
    const other = queue.run('other', async () => 'independent');
    await expectAsync(failed).toBeRejectedWithError('offline');
    await expectAsync(next).toBeResolvedTo('saved');
    await expectAsync(other).toBeResolvedTo('independent');
  });
});
