const PAID_HINTS = ['cpc', 'ppc', 'paid', 'ads', 'adwords', 'display', 'retargeting'];
const SOCIAL_HINTS = ['facebook', 'instagram', 'fb', 'ig', 'linkedin', 'tiktok', 'twitter', 'x.com', 'youtube', 'social'];
const SEARCH_HINTS = ['google', 'bing', 'yahoo', 'duckduckgo', 'organic', 'search'];
const REFERRAL_HINTS = ['referral', 'referrer', 'partner', 'affiliate'];

/**
 * Resolve the lead source for one opportunity.
 *
 * HighLevel spreads this across three places, so they are tried in order of how
 * deliberately they are set: the opportunity's own source (usually set by the
 * workflow or user that created it), then the contact's first-touch attribution
 * (set automatically by the tracking script), then the contact's source field.
 */
export function resolveLeadSource(opportunity, contact) {
  const first = contact?.attributionSource ?? {};
  const last = contact?.lastAttributionSource ?? {};

  const candidates = [
    ['opportunity.source', opportunity?.source],
    ['attribution.utmSource', first.utmSource],
    ['attribution.sessionSource', first.sessionSource],
    ['attribution.referrer', hostOf(first.referrer)],
    ['contact.source', contact?.source],
  ];

  let source = 'Unknown';
  let resolvedFrom = 'none';
  for (const [origin, value] of candidates) {
    const clean = normalise(value);
    if (clean) {
      source = clean;
      resolvedFrom = origin;
      break;
    }
  }

  const medium = normalise(first.utmMedium) ?? normalise(last.utmMedium) ?? null;

  return {
    source,
    resolvedFrom,
    channel: classifyChannel(source, medium, first),
    firstTouch: {
      sessionSource: normalise(first.sessionSource) ?? null,
      utmSource: normalise(first.utmSource) ?? null,
      utmMedium: medium,
      utmCampaign: normalise(first.campaign) ?? normalise(first.utmCampaign) ?? null,
      utmContent: normalise(first.utmContent) ?? null,
      utmKeyword: normalise(first.utmKeyword) ?? null,
      referrer: normalise(first.referrer) ?? null,
      gclid: normalise(first.gclid) ?? null,
      fbclid: normalise(first.fbclid) ?? null,
    },
    lastTouch: {
      sessionSource: normalise(last.sessionSource) ?? null,
      utmSource: normalise(last.utmSource) ?? null,
      utmMedium: normalise(last.utmMedium) ?? null,
      utmCampaign: normalise(last.campaign) ?? normalise(last.utmCampaign) ?? null,
    },
  };
}

/** Bucket a raw source string into a channel for the dashboard's rollup. */
export function classifyChannel(source, medium, attribution = {}) {
  const haystack = [source, medium, attribution.sessionSource, attribution.referrer]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!haystack || haystack === 'unknown') return 'Unknown';
  if (attribution.gclid || attribution.fbclid) return 'Paid';
  if (PAID_HINTS.some((hint) => haystack.includes(hint))) return 'Paid';
  if (SOCIAL_HINTS.some((hint) => haystack.includes(hint))) return 'Social';
  if (REFERRAL_HINTS.some((hint) => haystack.includes(hint))) return 'Referral';
  if (SEARCH_HINTS.some((hint) => haystack.includes(hint))) return 'Search';
  if (haystack.includes('direct')) return 'Direct';
  return 'Other';
}

function normalise(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') return null;
  return trimmed;
}

function hostOf(url) {
  const clean = normalise(url);
  if (!clean) return null;
  try {
    return new URL(clean).hostname.replace(/^www\./, '');
  } catch {
    return clean;
  }
}
