// Pattern matching engine for commission detection.
// Pure functions — no Chrome API dependencies.
// Used both as a standalone "No-AI mode" and as a fallback when the AI model times out.

const OPEN_PATTERNS = [
  /\bcomm?(?:ission)?s?\s*(?:are\s+)?open\b/i,
  /\bc0mm?(?:ission)?s?\s*(?:are\s+)?open\b/i,
  /\bc0mm?s?\s*0pen\b/i,
  /\bc\*mm?s?\s*open\b/i,
  /\btaking\s+comm?(?:ission)?s?\b/i,
  /\bcomm?(?:ission)?s?\s+slots?\s+(?:open|available)\b/i,
  /\bopen\s+for\s+comm?(?:ission)?s?\b/i,
  /\bopen\s+comm?(?:ission)?s?\b/i,
  /\bcommissions?\s*:\s*open\b/i,
  /\bcommisisons\s+open\b/i,
  /\bСommission\s*-\s*open\b/i,
  /\baccept(?:ing)?\s+comm?(?:ission)?s?\b/i,
  /\bslots?\s+available\b/i,
  /\bdm\s+(?:me\s+)?for\s+comm?(?:ission)?s?\b/i,
  /\bqueue\s+(?:is\s+)?open\b/i
];

const CLOSED_PATTERNS = [
  /\bcomm?(?:ission)?s?\s*(?:are\s+)?closed?\b/i,
  /\bc\*mm?s?\s*closed?\b/i,
  /\bcom?s?\s*closed?\b/i,
  /\bnot\s+taking\s+comm?(?:ission)?s?\b/i,
  /\bno\s+comm?(?:ission)?s?\b/i,
  /\bclosed\s+(?:for\s+)?comm?(?:ission)?s?\b/i,
  /\bhiatus\b/i,
  /\bcomm?(?:ission)?s?\s*(?:are\s+)?(?:full|unavailable)\b/i,
  /\bcommissions?\s*:\s*closed\b/i,
  /\bqueue\s*(?:is\s+)?(?:full|closed)\b/i,
  /\bnot\s+accept(?:ing)?\s+comm?(?:ission)?s?\b/i,
  /\bfully\s+booked\b/i,
  /\bwaitlist\s+(?:is\s+)?closed\b/i
];

/**
 * Pattern-analyze a single text string.
 * @param {string|null} text
 * @returns {{ commissionStatus: string, confidence: number, method: string, triggers: string[] }}
 */
export function patternAnalyze(text) {
  if (!text) {
    return {
      commissionStatus: 'unclear',
      confidence: 0.3,
      method: 'pattern-matching',
      triggers: []
    };
  }

  const openMatches = [];
  const closedMatches = [];

  for (const pattern of OPEN_PATTERNS) {
    const match = text.match(pattern);
    if (match) openMatches.push(match[0]);
  }

  for (const pattern of CLOSED_PATTERNS) {
    const match = text.match(pattern);
    if (match) closedMatches.push(match[0]);
  }

  let commissionStatus = 'unclear';
  let confidence = 0.3;
  let triggers = [];

  if (closedMatches.length > 0 && openMatches.length === 0) {
    commissionStatus = 'closed';
    confidence = Math.min(0.8 + (closedMatches.length * 0.05), 0.95);
    triggers = closedMatches;
  } else if (openMatches.length > 0 && closedMatches.length === 0) {
    commissionStatus = 'open';
    confidence = Math.min(0.8 + (openMatches.length * 0.05), 0.95);
    triggers = openMatches;
  } else if (openMatches.length > 0 && closedMatches.length > 0) {
    if (closedMatches.length > openMatches.length) {
      commissionStatus = 'closed';
      confidence = 0.6;
      triggers = closedMatches;
    } else {
      commissionStatus = 'open';
      confidence = 0.6;
      triggers = openMatches;
    }
  }

  return {
    commissionStatus,
    confidence,
    method: 'pattern-matching',
    triggers: [...new Set(triggers)]
  };
}

/**
 * Pattern-analyze a full component set (displayName, bio, journal, gallery, posts).
 * @param {object} components
 * @returns {Promise<object>} (async to match AI analyzer signature, but runs sync)
 */
export async function patternAnalyzeComponents(components) {
  const results = {
    displayName: null,
    bio: null,
    journal: null,
    gallery: null,
    posts: null
  };

  let highestConfidence = 0;
  let overallStatus = 'unclear';
  let allTriggers = [];

  // Display name (high weight)
  if (components.displayName) {
    const displayNameResult = patternAnalyze(components.displayName);
    results.displayName = displayNameResult;
    if (displayNameResult.confidence > 0.7) {
      highestConfidence = displayNameResult.confidence;
      overallStatus = displayNameResult.commissionStatus;
      allTriggers.push(...displayNameResult.triggers);
    }
  }

  // Bio (high weight)
  if (components.bio) {
    const bioResult = patternAnalyze(components.bio);
    results.bio = bioResult;
    if (bioResult.confidence > highestConfidence) {
      highestConfidence = bioResult.confidence;
      overallStatus = bioResult.commissionStatus;
    }
    allTriggers.push(...bioResult.triggers);
  }

  // Journal (recent-journal weighting)
  if (components.journal && components.journal.text) {
    const journalResult = patternAnalyze(components.journal.text);
    results.journal = {
      ...journalResult,
      date: components.journal.date
    };

    const isRecent = components.journal.date &&
      (Date.now() - new Date(components.journal.date).getTime()) < 30 * 24 * 60 * 60 * 1000;

    if (isRecent && journalResult.confidence > highestConfidence) {
      highestConfidence = journalResult.confidence;
      overallStatus = journalResult.commissionStatus;
    }
    allTriggers.push(...journalResult.triggers);
  }

  // Gallery items
  if (components.gallery && components.gallery.items) {
    const galleryResults = [];
    for (const item of components.gallery.items) {
      const itemText = `${item.title || ''} ${item.description || ''} ${item.tags || ''}`.trim();
      if (itemText) {
        const itemResult = patternAnalyze(itemText);
        galleryResults.push({
          ...itemResult,
          url: item.url,
          date: item.date,
          title: item.title,
          description: item.description,
          thumbnailUrl: item.thumbnailUrl,
          imageUrl: item.imageUrl,
          previewUrl: item.previewUrl
        });
        allTriggers.push(...itemResult.triggers);
      }
    }

    if (galleryResults.length > 0) {
      const bestGalleryResult = galleryResults.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );
      results.gallery = {
        items: galleryResults,
        confidence: bestGalleryResult.confidence,
        commissionStatus: bestGalleryResult.commissionStatus
      };
      if (bestGalleryResult.confidence > highestConfidence * 0.8) {
        overallStatus = bestGalleryResult.commissionStatus;
      }
    }
  }

  // Posts
  if (components.posts && components.posts.items) {
    const postResults = [];
    for (const post of components.posts.items) {
      if (post.text) {
        const postResult = patternAnalyze(post.text);
        postResults.push({
          ...postResult,
          url: post.url,
          date: post.date,
          text: post.text,
          thumbnailUrl: post.thumbnailUrl,
          imageUrl: post.imageUrl,
          previewUrl: post.previewUrl,
          isPinned: post.isPinned
        });
        allTriggers.push(...postResult.triggers);
      }
    }

    if (postResults.length > 0) {
      const pinnedPosts = postResults.filter(p => p.isPinned);
      const bestPostResult = pinnedPosts.length > 0
        ? pinnedPosts.reduce((best, current) => current.confidence > best.confidence ? current : best)
        : postResults.reduce((best, current) => current.confidence > best.confidence ? current : best);

      results.posts = {
        items: postResults,
        confidence: bestPostResult.confidence,
        commissionStatus: bestPostResult.commissionStatus
      };

      if (bestPostResult.isPinned && bestPostResult.confidence > 0.7) {
        highestConfidence = bestPostResult.confidence;
        overallStatus = bestPostResult.commissionStatus;
      }
    }
  }

  return {
    commissionStatus: overallStatus,
    confidence: highestConfidence,
    components: results,
    method: 'pattern-matching',
    triggers: [...new Set(allTriggers)].slice(0, 5)
  };
}

export { OPEN_PATTERNS, CLOSED_PATTERNS };
