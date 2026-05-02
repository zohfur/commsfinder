const E621_API_BASE_URL = 'https://e621.net';
const E621_POSTS_PER_PAGE = 320;
const E621_MAX_POST_PAGES = 10;
const E621_RELEVANT_TAG_LIMIT = 80;
const E621_TAG_CATEGORIES = {
  general: 0,
  artist: 1,
  copyright: 3,
  character: 4,
  species: 5,
  invalid: 6,
  meta: 7,
  lore: 8,
};
const E621_RELEVANT_POST_TAG_FIELDS = ['general', 'species'];

// e621 allows max 2 requests/second for anonymous clients; start at 1 req/s (1000ms)
// and back off further on 503/429.
const E621_MIN_RATE_LIMIT_MS = 1000;
const E621_MAX_RATE_LIMIT_MS = 8000;
const E621_BACKOFF_STEP_MS = 2000;
const E621_RECOVERY_STEP_MS = 250;
const E621_RECOVERY_SUCCESSES = 8;
const E621_MAX_RETRIES = 4;

let currentE621RateLimitMs = E621_MIN_RATE_LIMIT_MS;
let e621ConsecutiveSuccesses = 0;
let nextE621RequestAt = 0;
const e621ArtistTagCache = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function increaseE621RateLimit(statusCode) {
  e621ConsecutiveSuccesses = 0;
  currentE621RateLimitMs = Math.min(currentE621RateLimitMs + E621_BACKOFF_STEP_MS, E621_MAX_RATE_LIMIT_MS);
  console.warn(`[e621] Rate limited (${statusCode}), backing off to ${currentE621RateLimitMs}ms`);
}

function recordE621Success() {
  e621ConsecutiveSuccesses++;
  if (e621ConsecutiveSuccesses >= E621_RECOVERY_SUCCESSES && currentE621RateLimitMs > E621_MIN_RATE_LIMIT_MS) {
    currentE621RateLimitMs = Math.max(currentE621RateLimitMs - E621_RECOVERY_STEP_MS, E621_MIN_RATE_LIMIT_MS);
    e621ConsecutiveSuccesses = 0;
  }
}

async function waitForE621RateLimit() {
  const now = Date.now();
  if (now < nextE621RequestAt) {
    await sleep(nextE621RequestAt - now);
  }
  nextE621RequestAt = Date.now() + currentE621RateLimitMs;
}

function normalizeE621TagName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function compactName(value) {
  return normalizeE621TagName(value).replace(/_/g, '');
}

function titleizeTag(value) {
  return normalizeE621TagName(value)
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function calculateNameSimilarity(a, b) {
  const normalizedA = compactName(a);
  const normalizedB = compactName(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;

  const minLength = Math.min(normalizedA.length, normalizedB.length);
  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  if (minLength < 4) return 0;

  const distance = levenshteinDistance(normalizedA, normalizedB);
  const editScore = 1 - distance / maxLength;
  const containmentScore = normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)
    ? minLength / maxLength
    : 0;

  return Math.max(editScore, containmentScore);
}

function isLikelyArtistTagMatch(profileUsername, candidateName) {
  const profileName = compactName(profileUsername);
  const candidate = compactName(candidateName);
  if (!profileName || !candidate) return false;
  if (profileName === candidate) return true;
  if (Math.min(profileName.length, candidate.length) < 5) return false;
  return calculateNameSimilarity(profileName, candidate) >= 0.82;
}

function selectBestArtistTag(profileUsername, candidates = []) {
  const normalizedUsername = normalizeE621TagName(profileUsername);
  const scoredCandidates = candidates
    .filter(candidate => candidate?.name && candidate.category === E621_TAG_CATEGORIES.artist)
    .map(candidate => ({
      ...candidate,
      matchScore: calculateNameSimilarity(normalizedUsername, candidate.name),
    }))
    .filter(candidate => isLikelyArtistTagMatch(normalizedUsername, candidate.name))
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return (b.post_count || 0) - (a.post_count || 0);
    });

  return scoredCandidates[0] || null;
}

function buildE621Url(path, params = {}) {
  const url = new URL(path, E621_API_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function fetchE621Json(path, params, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('Fetch is not available for e621 tag enrichment');
  }

  const maxRetries = options.maxRetries ?? E621_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await waitForE621RateLimit();

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), options.timeoutMs || 15000)
      : null;

    try {
      const response = await fetchImpl(buildE621Url(path, params), {
        headers: { Accept: 'application/json' },
        signal: controller?.signal,
      });

      if (response.status === 429 || response.status === 503) {
        increaseE621RateLimit(response.status);
        if (attempt < maxRetries) {
          const retryAfterHeader = response.headers?.get?.('Retry-After');
          const extraWait = retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000
            : currentE621RateLimitMs;
          await sleep(extraWait);
          continue;
        }
        throw new Error(`e621 rate limited (${response.status}) after ${attempt + 1} attempts`);
      }

      if (!response.ok) {
        throw new Error(`e621 request failed with ${response.status}`);
      }

      recordE621Success();
      return await response.json();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

async function searchE621ArtistTag(profileUsername, options = {}) {
  const normalizedUsername = normalizeE621TagName(profileUsername);
  if (normalizedUsername.length < 3) return null;

  const searches = [
    normalizedUsername,
    `*${normalizedUsername}*`,
  ];
  const candidateMap = new Map();

  for (const nameMatches of searches) {
    const candidates = await fetchE621Json('/tags.json', {
      'search[category]': E621_TAG_CATEGORIES.artist,
      'search[name_matches]': nameMatches,
      'search[order]': 'count',
      limit: 25,
    }, options);

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      candidateMap.set(candidate.name, candidate);
    }
  }

  return selectBestArtistTag(normalizedUsername, [...candidateMap.values()]);
}

async function fetchAllPostsForArtistTag(artistTag, options = {}) {
  const posts = [];
  let beforePostId = null;
  const maxPages = options.maxPostPages || E621_MAX_POST_PAGES;

  for (let page = 0; page < maxPages; page++) {
    const payload = await fetchE621Json('/posts.json', {
      tags: artistTag,
      limit: E621_POSTS_PER_PAGE,
      page: beforePostId ? `b${beforePostId}` : undefined,
    }, options);
    const pagePosts = Array.isArray(payload?.posts) ? payload.posts : [];
    if (pagePosts.length === 0) break;

    posts.push(...pagePosts);
    beforePostId = pagePosts[pagePosts.length - 1]?.id;
    if (pagePosts.length < E621_POSTS_PER_PAGE || !beforePostId) break;
  }

  return posts;
}

function collectRelevantE621Tags(posts = []) {
  const counts = new Map();
  const totalPosts = posts.length;
  if (totalPosts === 0) return [];

  for (const post of posts) {
    const postTags = post?.tags || {};
    for (const field of E621_RELEVANT_POST_TAG_FIELDS) {
      for (const tag of postTags[field] || []) {
        const normalizedTag = normalizeE621TagName(tag);
        if (!normalizedTag) continue;
        const existing = counts.get(normalizedTag) || {
          tag: normalizedTag,
          category: field === 'species' ? 'species' : 'general',
          count: 0,
        };
        existing.count += 1;
        counts.set(normalizedTag, existing);
      }
    }
  }

  const minimumCount = totalPosts >= 10 ? 2 : 1;
  const minimumRatio = totalPosts >= 20 ? 0.03 : 0;

  return [...counts.values()]
    .map(tag => ({
      ...tag,
      ratio: tag.count / totalPosts,
    }))
    .filter(tag => tag.count >= minimumCount && tag.ratio >= minimumRatio)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, E621_RELEVANT_TAG_LIMIT);
}

function buildE621TagClassification(artistTag, posts = []) {
  const relevantTags = collectRelevantE621Tags(posts);
  const profileTags = relevantTags.map(tag => {
    const label = titleizeTag(tag.tag);
    return {
      tag: tag.tag,
      label,
      category: tag.category,
      aliases: [tag.tag, label],
      matchedAliases: [tag.tag],
      sources: ['e621:posts'],
      score: Number((tag.count + tag.ratio * 5).toFixed(2)),
      impliedBy: [],
      postCount: tag.count,
      postRatio: Number(tag.ratio.toFixed(3)),
    };
  });
  const tagAliases = [...new Set(profileTags.flatMap(tag => [tag.tag, tag.label, ...(tag.aliases || [])]))]
    .filter(Boolean);

  return {
    profileTags,
    tagSearchText: tagAliases.join(' '),
    tagAliases,
    tagMatches: profileTags.map(tag => ({
      tag: tag.tag,
      alias: tag.tag,
      source: 'e621:posts',
      match: artistTag,
    })),
    e621ArtistTag: artistTag,
    e621PostCount: posts.length,
  };
}

async function classifyProfileTagsFromE621(profile, options = {}) {
  const profileUsername = profile?.username;
  const normalizedUsername = normalizeE621TagName(profileUsername);
  if (!normalizedUsername) return null;
  if (e621ArtistTagCache.has(normalizedUsername)) {
    return e621ArtistTagCache.get(normalizedUsername);
  }

  try {
    const artistTag = await searchE621ArtistTag(profileUsername, options);
    if (!artistTag) {
      e621ArtistTagCache.set(normalizedUsername, null);
      return null;
    }

    const posts = await fetchAllPostsForArtistTag(artistTag.name, options);
    const classification = buildE621TagClassification(artistTag.name, posts);
    e621ArtistTagCache.set(normalizedUsername, classification);
    return classification;
  } catch (error) {
    console.warn('[e621] Failed to enrich profile tags:', error);
    return null;
  }
}

export {
  classifyProfileTagsFromE621,
  buildE621TagClassification,
  calculateNameSimilarity,
  collectRelevantE621Tags,
  isLikelyArtistTagMatch,
  normalizeE621TagName,
  selectBestArtistTag,
};
