import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './bus';

describe('EventBus', () => {
  it('delivers payloads and supports unsubscribe', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('app.opened', fn);
    bus.emit('app.opened', { pluginId: 'chat' });
    expect(fn).toHaveBeenCalledWith({ pluginId: 'chat' });
    off();
    bus.emit('app.opened', { pluginId: 'chat' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing handler from the others', () => {
    const bus = new EventBus();
    const ok = vi.fn();
    bus.on('x.y', () => { throw new Error('boom'); });
    bus.on('x.y', ok);
    bus.emit('x.y', 1);
    expect(ok).toHaveBeenCalledWith(1);
  });
});
