export type EventEmailIdentity = { avatarName?: string; returnUrl?: string };

/** Fixed copy is translated before inserting organizer-controlled names. A message editor can extend this later. */
export function eventEmailNote(eventName: string, hasPlan: boolean, identity: EventEmailIdentity, copy: (source: string) => string) {
  const name = identity.avatarName?.replace(/\s+/g, ' ').trim().slice(0, 120) || '';
  const fill = (source: string) => copy(source).replace(/\{(event|avatar)\}/g, (_, key: string) => key === 'event' ? eventName : name);
  return {
    eyebrow: name ? fill('A note from {avatar}') : copy('A note from your guide'),
    greeting: copy('Hi - I really enjoyed speaking with you!'),
    introduction: fill(/^CES(?:\s+\d{4})?$/i.test(eventName.trim())
      ? '{event} is an unmatched venue for experiencing all the incredible innovations transforming how we live.'
      : '{event} brings people, ideas and new experiences together.'),
    plan: copy(hasPlan ? 'Below is your personalized plan.' : 'Below are your event details.'),
    invitation: copy('Please talk with me again if you need updated information.'),
    enjoy: copy('Enjoy your stay!'),
    cheers: copy('Cheers,'),
    signature: name || copy('Your event guide'),
    talkAgain: name ? fill('Talk to {avatar} again') : copy('Talk to your guide again'),
    anotherQuestion: copy('Have another question?'),
  };
}
