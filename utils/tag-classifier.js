// Deterministic profile tag classifier.
// Uses curated e621-style canonical tags, aliases, implications, and category filtering.

const ALLOWED_CATEGORIES = new Set(['general', 'species']);
const COMMON_WORD_EXCLUSIONS = new Set([
  'art',
  'artist',
  'draw',
  'drawing',
  'open',
  'closed',
  'commission',
  'commissions',
  'slot',
  'slots',
  'available',
  'profile',
  'post',
  'posts',
  'work',
  'works',
  'wolf',
]);

const TAG_METADATA = [
  {
    tag: 'werewolf',
    label: 'Werewolf',
    category: 'species',
    aliases: ['werewolf', 'werewolves', 'lycanthrope', 'lycanthropy', 'lycan', 'wolfman', 'wolf man'],
    implies: ['transformation', 'anthro'],
  },
  {
    tag: 'transformation',
    label: 'Transformation',
    category: 'general',
    aliases: [
      'transformation',
      'transformations',
      'transforming',
      'transformed',
      'tf',
      'tfs',
      'body transformation',
      'species transformation',
      'shape shifting',
      'shapeshifting',
      'shifter',
    ],
    implies: [],
  },
  {
    tag: 'anthro',
    label: 'Anthro',
    category: 'species',
    aliases: ['anthro', 'anthropomorphic', 'furry', 'furries', 'furry art', 'kemono', 'animal person'],
    implies: [],
  },
  {
    tag: 'painting',
    label: 'Painting',
    category: 'general',
    aliases: ['painting', 'paintings', 'painted', 'painterly', 'digital painting', 'oil painting', 'acrylic painting'],
    implies: [],
  },
  {
    tag: 'digital_art',
    label: 'Digital Art',
    category: 'general',
    aliases: ['digital art', 'digital artwork', 'digital artist', 'digital illustration', 'digital drawing', 'digital painting'],
    implies: ['painting'],
  },
  {
    tag: 'traditional_art',
    label: 'Traditional Art',
    category: 'general',
    aliases: [
      'traditional art',
      'traditional artwork',
      'traditional media',
      'traditional artist',
      'watercolor',
      'watercolour',
      'gouache',
      'acrylic',
      'oil paint',
      'colored pencil',
      'coloured pencil',
      'marker art',
      'ink drawing',
    ],
    implies: [],
  },
  {
    tag: 'goo',
    label: 'Goo',
    category: 'general',
    aliases: ['goo', 'goo_(disambiguation)', 'gooey', 'slime', 'slimy', 'ooze', 'mucus', 'goo creature', 'slime creature', 'liquid creature'],
    implies: [],
  },
  {
    tag: 'hypnosis',
    label: 'Hypnosis',
    category: 'general',
    aliases: [
      'hypnosis',
      'hypnotism',
      'hypnotic',
      'hypno',
      'hypnotized',
      'hypnotised',
      'mesmerized',
      'mesmerised',
      'trance',
      'mind control',
      'mind-control',
    ],
    implies: [],
  },
  {
    tag: 'copyright_name',
    label: 'Ignored Copyright Name',
    category: 'copyright',
    aliases: ['wolfwalkers'],
    implies: ['werewolf'],
  },
  {
    tag: 'artist_name',
    label: 'Ignored Artist Name',
    category: 'artist',
    aliases: ['anthrocon'],
    implies: ['anthro'],
  },
];

function normalizeTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCommonSingleWord(alias) {
  const normalized = normalizeTerm(alias);
  return !normalized.includes(' ') && COMMON_WORD_EXCLUSIONS.has(normalized);
}

function compileAliasPattern(alias) {
  const normalized = normalizeTerm(alias);
  const escapedParts = normalized.split(' ').map(escapeRegExp);
  const body = escapedParts.join('[\\s_-]+');
  const prefix = normalized.length <= 3 ? '(?:^|[\\s#_/.-])' : '(?:^|[^\\p{L}\\p{N}])';
  const suffix = '(?=$|[^\\p{L}\\p{N}])';
  return new RegExp(`${prefix}(${body})${suffix}`, 'iu');
}

const TAG_BY_NAME = new Map(TAG_METADATA.map(tag => [tag.tag, tag]));
const COMPILED_TAGS = TAG_METADATA
  .filter(tag => ALLOWED_CATEGORIES.has(tag.category))
  .map(tag => ({
    ...tag,
    compiledAliases: tag.aliases
      .filter(alias => !isCommonSingleWord(alias))
      .map(alias => ({
        alias,
        normalized: normalizeTerm(alias),
        pattern: compileAliasPattern(alias),
      })),
  }));

function addTextSource(sources, name, value, weight = 1) {
  if (typeof value !== 'string') return;
  const normalized = normalizeTerm(value);
  if (!normalized) return;
  sources.push({ name, text: ` ${normalized} `, weight });
}

function addGallerySources(sources, galleryItems = []) {
  if (!Array.isArray(galleryItems)) return;
  galleryItems.forEach((item, index) => {
    addTextSource(sources, `gallery:${index}:title`, item?.title, 1.1);
    addTextSource(sources, `gallery:${index}:description`, item?.description, 0.9);
    addTextSource(sources, `gallery:${index}:tags`, item?.tags, 1.6);
  });
}

function addPostSources(sources, posts = []) {
  if (!Array.isArray(posts)) return;
  posts.forEach((post, index) => {
    addTextSource(sources, `post:${index}`, post?.text, post?.isPinned ? 1.3 : 0.8);
  });
}

function collectProfileSources(profile) {
  const sources = [];
  addTextSource(sources, 'displayName', profile?.displayName, 0.8);
  addTextSource(sources, 'username', profile?.username, 0.4);
  addTextSource(sources, 'bio', profile?.bio, 1.2);
  addTextSource(sources, 'journal', profile?.journal, 1);
  addTextSource(sources, 'commissionStatus', profile?.commissionStatus, 0.4);
  addGallerySources(sources, profile?.galleryItems);
  addPostSources(sources, profile?.posts);
  if (profile?.pinnedPost) addTextSource(sources, 'pinnedPost', profile.pinnedPost.text, 1.4);
  if (profile?.recentPost) addTextSource(sources, 'recentPost', profile.recentPost.text, 0.8);
  return sources;
}

function emptyClassification() {
  return {
    profileTags: [],
    tagSearchText: '',
    tagAliases: [],
    tagMatches: [],
  };
}

function ensureTag(resultMap, tagName, reason = 'direct') {
  const metadata = TAG_BY_NAME.get(tagName);
  if (!metadata || !ALLOWED_CATEGORIES.has(metadata.category)) return null;

  if (!resultMap.has(tagName)) {
    resultMap.set(tagName, {
      tag: metadata.tag,
      label: metadata.label,
      category: metadata.category,
      aliases: [...metadata.aliases],
      matchedAliases: [],
      sources: [],
      score: 0,
      impliedBy: [],
    });
  }

  const result = resultMap.get(tagName);
  if (reason !== 'direct' && !result.impliedBy.includes(reason)) {
    result.impliedBy.push(reason);
  }
  return result;
}

function applyImplications(resultMap, tagName, visited = new Set()) {
  if (visited.has(tagName)) return;
  visited.add(tagName);

  const metadata = TAG_BY_NAME.get(tagName);
  if (!metadata) return;

  for (const impliedTag of metadata.implies || []) {
    const implied = ensureTag(resultMap, impliedTag, tagName);
    if (implied) {
      implied.score = Math.max(implied.score, 0.5);
      applyImplications(resultMap, impliedTag, visited);
    }
  }
}

function classifyProfileTags(profile) {
  const sources = collectProfileSources(profile);
  if (sources.length === 0) return emptyClassification();

  const resultMap = new Map();
  const tagMatches = [];

  for (const tag of COMPILED_TAGS) {
    for (const compiledAlias of tag.compiledAliases) {
      for (const source of sources) {
        const match = compiledAlias.pattern.exec(source.text);
        if (!match) continue;

        const result = ensureTag(resultMap, tag.tag);
        if (!result) continue;

        if (!result.matchedAliases.includes(compiledAlias.alias)) {
          result.matchedAliases.push(compiledAlias.alias);
        }
        if (!result.sources.includes(source.name)) {
          result.sources.push(source.name);
        }
        result.score += source.weight;

        tagMatches.push({
          tag: tag.tag,
          alias: compiledAlias.alias,
          source: source.name,
          match: match[1],
        });
      }
    }
  }

  for (const tagName of [...resultMap.keys()]) {
    applyImplications(resultMap, tagName);
  }

  const profileTags = [...resultMap.values()]
    .map(tag => ({
      ...tag,
      score: Number(tag.score.toFixed(2)),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const tagAliases = [...new Set(profileTags.flatMap(tag => [tag.tag, tag.label, ...tag.aliases].map(normalizeTerm)))]
    .filter(Boolean);

  return {
    profileTags,
    tagSearchText: tagAliases.join(' '),
    tagAliases,
    tagMatches,
  };
}

export {
  classifyProfileTags,
  normalizeTerm,
  TAG_METADATA,
  COMMON_WORD_EXCLUSIONS,
};
