const assert = require('node:assert/strict');
const { test } = require('node:test');
const { cityGuidePersonaPrompt, resolveCityGuide, PICAMO_AVATAR } = require('../lib/city-guide');

test('every city uses Picamo by default, including legacy city guides', () => {
  for (const city of ['Miami', 'Cape May', 'Las Vegas', 'Philadelphia', 'Tokyo', 'Aix-en-Provence']) {
    for (const name of [null, city, `${city} Guide`, 'LivingWiki', 'Picamo', 'B. Franklin']) {
      const result = resolveCityGuide({ name: `LivingWiki: ${city}`, wiki_type: 'city',
        city_config: { enabled: true, city_name: city }, chat_guide: { name, banner_url: '/city.jpg' } });
      assert.equal(result.name, 'Picamo');
      assert.equal(result.image_url, PICAMO_AVATAR);
      assert.equal(result.banner_url, '/city.jpg');
    }
  }
});

test('an explicitly enabled custom city guide keeps its name, portrait and instructions label', () => {
  const guide = { name: 'Marisol', label: 'Your art historian', image_url: '/marisol.webp', banner_url: '/miami.jpg', city_persona_override: true };
  assert.deepEqual(resolveCityGuide({ wiki_type: 'city', chat_guide: guide }), guide);
});

test('legacy city prompts yield to Picamo and explicitly opted-out prompts stay intact', () => {
  const atlas = { wiki_type: 'city', name: 'Philadelphia', chat_guide: { name: 'B. Franklin' } };
  assert.match(cityGuidePersonaPrompt(atlas, 'You are Benjamin Franklin.'), /You are Picamo/);
  assert.doesNotMatch(cityGuidePersonaPrompt(atlas, 'You are Benjamin Franklin.'), /You are Benjamin Franklin/);
  atlas.chat_guide.city_persona_override = true;
  assert.equal(cityGuidePersonaPrompt(atlas, 'You are Benjamin Franklin.'), 'You are Benjamin Franklin.');
  assert.equal(cityGuidePersonaPrompt({ wiki_type: 'person' }, 'You are George Washington.'), 'You are George Washington.');
});

test('legacy city configurations are supported and other wiki identities remain separate', () => {
  assert.equal(resolveCityGuide({ city_config: { enabled: true } }).name, 'Picamo');
  assert.equal(resolveCityGuide({ wiki_type: 'university', city_config: { enabled: true } }), null);
  assert.equal(resolveCityGuide({ wiki_type: 'person', name: 'George Washington' }), null);
  assert.equal(resolveCityGuide({ wiki_type: 'organization' }), null);
  assert.equal(resolveCityGuide(null), null);
});
