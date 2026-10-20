import { PicamoCityChatService } from './picamo-city-chat.service';

describe('Picamo city conversation routing', () => {
  it('keeps the active city context when an older city is destroyed', () => {
    const service = new PicamoCityChatService();
    const disconnectFirst = service.connect({ name: 'Picamo', avatarUrl: '/picamo.png', focus: () => {} });
    const focus = jasmine.createSpy('focus current city');
    const current = { name: 'Picamo', avatarUrl: '/picamo.png', focus };
    const disconnectCurrent = service.connect(current);
    disconnectFirst();
    expect(service.context()).toBe(current);
    service.context()!.focus();
    expect(focus).toHaveBeenCalledTimes(1);
    disconnectCurrent();
    expect(service.context()).toBeNull();
  });
});
