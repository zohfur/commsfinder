import {
  buildE621TagClassification,
  collectRelevantE621Tags,
  findLocalE621ArtistTag,
  isLikelyArtistTagMatch,
  normalizeE621ArtistSearchName,
  normalizeE621TagName,
  scoreLocalArtistTagMatch,
  searchE621ArtistTag,
  selectBestArtistTag,
} from '../utils/e621-tagger.js';

describe('e621 tag enrichment', () => {
  test('normalizes profile names into e621 tag names', () => {
    expect(normalizeE621TagName('@Moon Artist')).toBe('moon_artist');
    expect(normalizeE621TagName('Fox-and-Wolf')).toBe('fox_and_wolf');
    expect(normalizeE621TagName('hypno')).toBe('hypnosis');
  });

  test('uses only the account name for Bluesky handles before e621 lookup', () => {
    expect(normalizeE621ArtistSearchName({
      username: 'dendryte-axxon.bsky.social',
      platform: 'bluesky',
    })).toBe('dendryte_axxon');
    expect(normalizeE621ArtistSearchName({
      username: 'artist.example.com',
      platform: 'bluesky',
    })).toBe('artist');
    expect(normalizeE621ArtistSearchName({
      username: 'artist.example.com',
      platform: 'furaffinity',
    })).toBe('artist_example_com');
  });

  test('selects fuzzy artist tag matches over unrelated candidates', () => {
    const match = selectBestArtistTag('MoonArtist', [
      { name: 'moon_artist', category: 1, post_count: 120 },
      { name: 'moon_artist_fan', category: 1, post_count: 500 },
      { name: 'moon', category: 0, post_count: 1000 },
    ]);

    expect(match.name).toBe('moon_artist');
    expect(isLikelyArtistTagMatch('MoonArtist', 'moon_artist')).toBe(true);
    expect(isLikelyArtistTagMatch('MoonArtist', 'sun_artist')).toBe(false);
  });

  test('finds local artist tag matches before searching e621 remotely', async () => {
    const artistTags = ['klondike', 'unrelated_artist'];

    expect(findLocalE621ArtistTag('klondikeart', artistTags)?.name).toBe('klondike');
    expect(findLocalE621ArtistTag('klondikedraws', artistTags)?.name).toBe('klondike');
    expect(scoreLocalArtistTagMatch('klondikeart', 'klondike')).toBeGreaterThan(0.9);

    const match = await searchE621ArtistTag('klondikeart', {
      artistTags,
      fetchImpl: () => {
        throw new Error('remote e621 search should not run when local artist tag matches');
      },
    });

    expect(match).toEqual(expect.objectContaining({
      name: 'klondike',
      source: 'local-export',
    }));
  });

  test('aggregates relevant general and species tags from artist posts', () => {
    const posts = [
      {
        tags: {
          general: ['transformation', 'hypno', 'sketch', 'simple_background', 'clothing'],
          species: ['werewolf', 'mammal'],
          artist: ['moon_artist'],
        },
      },
      {
        tags: {
          general: ['transformation', 'digital_art'],
          species: ['werewolf'],
          character: ['oc_name'],
        },
      },
      {
        tags: {
          general: ['transformation', 'hypnosis'],
          species: ['wolf'],
        },
      },
    ];

    const tags = collectRelevantE621Tags(posts).map(tag => tag.tag);
    expect(tags).toEqual(expect.arrayContaining([
      'transformation',
      'werewolf',
      'hypnosis',
      'digital_art',
      'wolf',
    ]));
    expect(tags).not.toEqual(expect.arrayContaining([
      'simple_background',
      'clothing',
      'mammal',
    ]));
    expect(tags).not.toContain('moon_artist');
    expect(tags).not.toContain('oc_name');
  });

  test('builds profile tag shape from e621 post tags', () => {
    const result = buildE621TagClassification('moon_artist', [
      {
        tags: {
          general: ['digital_art'],
          species: ['werewolf'],
        },
      },
    ]);

    expect(result.e621ArtistTag).toBe('moon_artist');
    expect(result.e621PostCount).toBe(1);
    expect(result.profileTags).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tag: 'digital_art',
        label: 'Digital Art',
        sources: ['e621:posts'],
      }),
      expect.objectContaining({
        tag: 'werewolf',
        category: 'species',
      }),
    ]));
    expect(result.tagSearchText).toContain('Digital Art');
  });
});
