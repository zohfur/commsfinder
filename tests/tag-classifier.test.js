import { classifyProfileTags } from '../utils/tag-classifier.js';

function tagNames(result) {
  return result.profileTags.map(tag => tag.tag);
}

describe('tag classifier', () => {
  test('canonicalizes aliases and expands implications', () => {
    const result = classifyProfileTags({
      displayName: 'Moon Artist',
      bio: 'Lycanthrope TF art and werewolf commissions.',
    });

    expect(tagNames(result)).toEqual(expect.arrayContaining([
      'werewolf',
      'transformation',
      'anthro',
    ]));
    expect(result.tagSearchText).toContain('wolfman');
    expect(result.tagSearchText).toContain('lycanthropy');
  });

  test('matches media tags from gallery metadata', () => {
    const result = classifyProfileTags({
      galleryItems: [
        {
          title: 'Digital painting study',
          description: 'Watercolor sketchbook page',
          tags: 'digital_art traditional_media',
        },
      ],
    });

    expect(tagNames(result)).toEqual(expect.arrayContaining([
      'digital_art',
      'traditional_art',
      'painting',
    ]));
  });

  test('detects requested kink-related tags without AI', () => {
    const result = classifyProfileTags({
      bio: 'Goo creature and hypnosis / mind control themed illustrations.',
    });

    expect(tagNames(result)).toEqual(expect.arrayContaining(['goo', 'hypnosis']));
  });

  test('excludes common words and irrelevant e621 categories', () => {
    const result = classifyProfileTags({
      username: 'wolfwalkers',
      bio: 'Wolf artist with commissions open at Anthrocon.',
    });

    expect(tagNames(result)).not.toContain('werewolf');
    expect(tagNames(result)).not.toContain('anthro');
  });
});
