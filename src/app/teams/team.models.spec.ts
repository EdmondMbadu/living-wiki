import {
  filterTeamListings,
  teamError,
  teamInitials,
  teamSlugInput,
  type TeamListing,
  type TeamMember,
} from './team.models';
describe('team workspace presentation', () => {
  const listings = [
    {
      id: '1',
      title: 'Oak House',
      description: 'Alexandria',
      status: 'published',
      representativeId: 'a',
      updatedAt: '2026-09-01',
    },
    {
      id: '2',
      title: 'River House',
      description: 'McLean',
      status: 'draft',
      representativeId: 'b',
      updatedAt: '2026-09-02',
    },
  ] as TeamListing[];
  const members = [
    { uid: 'a', name: 'Elena' },
    { uid: 'b', name: 'Sophia' },
  ] as TeamMember[];
  it('searches every listing and representative before pagination', () => {
    expect(filterTeamListings(listings, members, 'sophia', '', '').map((item) => item.id)).toEqual([
      '2',
    ]);
    expect(
      filterTeamListings(listings, members, 'house', 'published', '').map((item) => item.id),
    ).toEqual(['1']);
    expect(filterTeamListings(listings, members, '', '', 'b').map((item) => item.id)).toEqual([
      '2',
    ]);
    expect(filterTeamListings(listings, members, '', '', '').map((item) => item.id)).toEqual([
      '2',
      '1',
    ]);
  });
  it('provides readable branding and failure fallbacks', () => {
    expect(teamInitials('Marchese Real Estate')).toBe('MR');
    expect(teamInitials('')).toBe('T');
    expect(teamSlugInput('Élite Real Estate')).toBe('elite-real-estate');
    expect(teamError(new Error('INTERNAL'))).toContain('try again');
  });
});
