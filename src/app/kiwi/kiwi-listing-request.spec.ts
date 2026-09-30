import { kiwiListingIntent, kiwiListingUrl } from './kiwi-listing-request';

describe('Kiwi property TalkThru requests', () => {
  it('recognizes sale and rental creation without sending generic boards to the property wizard', () => {
    expect(kiwiListingIntent('Create a real estate TalkThru')).toBe('sale');
    expect(kiwiListingIntent('Please make a rental board')).toBe('rental');
    expect(kiwiListingIntent('Build a vacation home tour')).toBe('rental');
    expect(kiwiListingIntent('Create a TalkThru for my property')).toBe('choose');
    expect(kiwiListingIntent('Create a board about French cuisine')).toBeNull();
    expect(kiwiListingIntent('Create a board about rental cars')).toBeNull();
    expect(kiwiListingIntent('Create a board about real estate investing')).toBeNull();
  });

  it('accepts public listing links and rejects non-web input', () => {
    expect(kiwiListingUrl('Here is www.example.com/listing/123.')).toBe('https://www.example.com/listing/123');
    expect(kiwiListingUrl('https://example.com/listing?ref=kiwi')).toBe('https://example.com/listing?ref=kiwi');
    expect(kiwiListingUrl('file:///private/listing')).toBeNull();
    expect(kiwiListingUrl('not a link')).toBeNull();
  });
});
