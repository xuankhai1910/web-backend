import { SimpleSemaphore } from './simple-semaphore';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('SimpleSemaphore', () => {
  it('never lets more than `limit` tasks run concurrently', async () => {
    const sem = new SimpleSemaphore(2);
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const release = await sem.acquire();
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(5);
        active--;
        release();
      }),
    );

    expect(maxActive).toBe(2);
  });

  it('wakes waiters in FIFO order', async () => {
    const sem = new SimpleSemaphore(1);
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 4 }, async (_, i) => {
        const release = await sem.acquire();
        order.push(i);
        await sleep(2);
        release();
      }),
    );

    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('treats a double release as a no-op', async () => {
    const sem = new SimpleSemaphore(1);
    const release = await sem.acquire();
    release();
    release(); // must NOT free a second slot

    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        const r = await sem.acquire();
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(2);
        active--;
        r();
      }),
    );

    expect(maxActive).toBe(1);
  });

  it('clamps a nonsense limit up to 1', async () => {
    const sem = new SimpleSemaphore(0);
    const release = await sem.acquire(); // would deadlock without the clamp
    release();
  });
});
