import {
  filterTeamListings,
  teamError,
  teamInitials,
  teamSlugInput,
  validateTeamReport,
  type TeamReport,
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
  it('requires complete, finite, nonnegative counts for the requested period', () => {
    const metrics = {
      views: 0,
      participants: 0,
      chats: 0,
      messages: 0,
      contacts: 0,
      voiceSeconds: null,
    };
    const report: TeamReport = {
      days: 30,
      trackingSince: '',
      totals: metrics,
      listings: { '1': metrics },
    };
    expect(validateTeamReport(report, 30)).toBe(report);
    expect(() => validateTeamReport(report, 7)).toThrow();
    for (const views of [undefined, null, '0', -1, NaN, Infinity, 0.5]) {
      expect(() =>
        validateTeamReport({ ...report, totals: { ...metrics, views } } as TeamReport, 30),
      ).toThrow();
    }
    for (const voiceSeconds of [undefined, -1, NaN, Infinity]) {
      expect(() =>
        validateTeamReport({ ...report, totals: { ...metrics, voiceSeconds } } as TeamReport, 30),
      ).toThrow();
    }
    expect(() =>
      validateTeamReport({ ...report, listings: { '1': { ...metrics, contacts: -1 } } }, 30),
    ).toThrow();
  });
});
