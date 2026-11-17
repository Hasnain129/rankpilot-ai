export interface CountryTargetInfo {
  code: string;
  label: string;
  gl: string;
  googleAdsGeoConstant: string | null;
  dataForSeoLocationCode: number | null;
}

export interface LanguageTargetInfo {
  code: string;
  label: string;
  googleAdsLanguageConstant: string;
}

export const COUNTRY_TARGETS: Record<string, CountryTargetInfo> = {
  PK: {
    code: 'PK',
    label: 'Pakistan',
    gl: 'pk',
    googleAdsGeoConstant: 'geoTargetConstants/2586',
    dataForSeoLocationCode: 2586,
  },
  US: {
    code: 'US',
    label: 'United States',
    gl: 'us',
    googleAdsGeoConstant: 'geoTargetConstants/2840',
    dataForSeoLocationCode: 2840,
  },
  GB: {
    code: 'GB',
    label: 'United Kingdom',
    gl: 'uk',
    googleAdsGeoConstant: 'geoTargetConstants/2826',
    dataForSeoLocationCode: 2826,
  },
  AE: {
    code: 'AE',
    label: 'United Arab Emirates',
    gl: 'ae',
    googleAdsGeoConstant: 'geoTargetConstants/2784',
    dataForSeoLocationCode: 2784,
  },
  CA: {
    code: 'CA',
    label: 'Canada',
    gl: 'ca',
    googleAdsGeoConstant: 'geoTargetConstants/2124',
    dataForSeoLocationCode: 2124,
  },
  AU: {
    code: 'AU',
    label: 'Australia',
    gl: 'au',
    googleAdsGeoConstant: 'geoTargetConstants/2036',
    dataForSeoLocationCode: 2036,
  },
  DE: {
    code: 'DE',
    label: 'Germany',
    gl: 'de',
    googleAdsGeoConstant: 'geoTargetConstants/2276',
    dataForSeoLocationCode: 2276,
  },
  IN: {
    code: 'IN',
    label: 'India',
    gl: 'in',
    googleAdsGeoConstant: 'geoTargetConstants/2356',
    dataForSeoLocationCode: 2356,
  },
  ALL: {
    code: 'ALL',
    label: 'Worldwide',
    gl: 'us',
    googleAdsGeoConstant: null,
    dataForSeoLocationCode: null,
  },
};

export const LANGUAGE_TARGETS: Record<string, LanguageTargetInfo> = {
  en: { code: 'en', label: 'English', googleAdsLanguageConstant: 'languageConstants/1000' },
  ur: { code: 'ur', label: 'Urdu', googleAdsLanguageConstant: 'languageConstants/1042' },
  ar: { code: 'ar', label: 'Arabic', googleAdsLanguageConstant: 'languageConstants/1019' },
  de: { code: 'de', label: 'German', googleAdsLanguageConstant: 'languageConstants/1001' },
  fr: { code: 'fr', label: 'French', googleAdsLanguageConstant: 'languageConstants/1002' },
  es: { code: 'es', label: 'Spanish', googleAdsLanguageConstant: 'languageConstants/1003' },
};

export interface KeywordProviderStatus {
  id: 'gemini_ai' | 'google_search_console' | 'google_ads' | 'dataforseo' | 'serp_api';
  name: string;
  connected: boolean;
  capability: string;
  pricingTier: string;
  missingEnvVars: string[];
  note: string;
}

export interface VerifiedKeywordMetric {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: 'Low' | 'Medium' | 'High' | null;
  competitionIndex: number | null;
  keywordDifficulty: number | null;
  dataSource: 'google_ads' | 'dataforseo';
}

const GOOGLE_ADS_REQUIRED_VARS = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
] as const;

const DATAFORSEO_REQUIRED_VARS = ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'] as const;

function missingVars(keys: readonly string[]): string[] {
  return keys.filter((k) => !process.env[k]?.trim());
}

export function getKeywordProvidersStatus(): KeywordProviderStatus[] {
  const adsMissing = missingVars(GOOGLE_ADS_REQUIRED_VARS);
  const dfsMissing = missingVars(DATAFORSEO_REQUIRED_VARS);
  const serpMissing = missingVars(['SERP_API_KEY']);

  return [
    {
      id: 'gemini_ai',
      name: 'Gemini AI Strategy Engine',
      connected: Boolean(process.env.GEMINI_API_KEY?.trim()),
      capability: 'Keyword discovery, long-tail & question ideation, search intent, clustering & WooCommerce mapping',
      pricingTier: 'Free / Server API Key',
      missingEnvVars: process.env.GEMINI_API_KEY?.trim() ? [] : ['GEMINI_API_KEY'],
      note: 'Generates strategic keyword ideas only — never invents numeric monthly search volumes or CPC.',
    },
    {
      id: 'google_search_console',
      name: 'Google Search Console (OAuth)',
      connected: true,
      capability: 'Verified impressions, clicks, CTR & ranking positions for your own verified domains',
      pricingTier: 'Free OAuth',
      missingEnvVars: [],
      note: 'Connected per user via Google OAuth in the Search Console & Rank Tracker modules.',
    },
    {
      id: 'google_ads',
      name: 'Google Ads Keyword Planner API',
      connected: adsMissing.length === 0,
      capability: 'Verified monthly Google search volume, competition index & historical CPC bids',
      pricingTier: 'API free; requires Google Ads account + Standard Access',
      missingEnvVars: adsMissing,
      note:
        adsMissing.length === 0
          ? 'Configured on server. Live historical metrics will enrich keyword research automatically.'
          : 'Not configured. Monthly search volume and CPC remain labeled Unavailable until configured.',
    },
    {
      id: 'dataforseo',
      name: 'DataForSEO / Google Ads Metrics API',
      connected: dfsMissing.length === 0,
      capability: 'Live search volume, CPC & competition metrics across 200+ countries',
      pricingTier: 'Paid Third-Party API (Pay-per-request)',
      missingEnvVars: dfsMissing,
      note:
        dfsMissing.length === 0
          ? 'Configured on server as verified volume & CPC provider.'
          : 'Not configured. Add credentials on server to populate live third-party keyword metrics.',
    },
    {
      id: 'serp_api',
      name: 'Authorized SERP Rank Tracker API',
      connected: serpMissing.length === 0,
      capability: 'External Google SERP position checking by country, language & device',
      pricingTier: 'Paid Third-Party API (Serper / SerpAPI)',
      missingEnvVars: serpMissing,
      note:
        serpMissing.length === 0
          ? 'Configured on server for live external SERP checks.'
          : 'Optional for rank tracking beyond your Search Console queries.',
    },
  ];
}

async function fetchGoogleAdsHistoricalMetrics(
  keywords: string[],
  countryCode: string,
  languageCode: string
): Promise<Record<string, VerifiedKeywordMetric>> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!.trim();
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID!.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET!.trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN!.trim();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!.trim().replace(/-/g, '');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google Ads OAuth token refresh failed (${tokenRes.status}).`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error('Google Ads OAuth response omitted access_token.');
  }

  const countryInfo = COUNTRY_TARGETS[countryCode] || COUNTRY_TARGETS.US;
  const langInfo = LANGUAGE_TARGETS[languageCode] || LANGUAGE_TARGETS.en;

  const body: Record<string, unknown> = {
    keywords: keywords.slice(0, 60),
    language: langInfo.googleAdsLanguageConstant,
    keywordPlanNetwork: 'GOOGLE_SEARCH',
  };
  if (countryInfo.googleAdsGeoConstant) {
    body.geoTargetConstants = [countryInfo.googleAdsGeoConstant];
  }

  const adsRes = await fetch(
    `https://googleads.googleapis.com/v18/customers/${encodeURIComponent(customerId)}:generateKeywordHistoricalMetrics`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        'developer-token': devToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (!adsRes.ok) {
    throw new Error(`Google Ads Keyword Planner returned HTTP ${adsRes.status}.`);
  }

  const adsJson = (await adsRes.json()) as {
    results?: Array<{
      text?: string;
      keywordMetrics?: {
        avgMonthlySearches?: string | number;
        competition?: string;
        competitionIndex?: string | number;
        highTopOfPageBidMicros?: string | number;
        lowTopOfPageBidMicros?: string | number;
      };
    }>;
  };

  const out: Record<string, VerifiedKeywordMetric> = {};
  for (const item of adsJson.results || []) {
    const kwText = String(item.text || '').trim().toLowerCase();
    if (!kwText || !item.keywordMetrics) continue;
    const km = item.keywordMetrics;
    const vol = km.avgMonthlySearches !== undefined ? Number(km.avgMonthlySearches) : null;
    const compIdx = km.competitionIndex !== undefined ? Number(km.competitionIndex) : null;
    const highBid = km.highTopOfPageBidMicros ? Number(km.highTopOfPageBidMicros) / 1_000_000 : null;
    const lowBid = km.lowTopOfPageBidMicros ? Number(km.lowTopOfPageBidMicros) / 1_000_000 : null;
    const cpc =
      highBid !== null && lowBid !== null
        ? Number(((highBid + lowBid) / 2).toFixed(2))
        : highBid !== null
        ? Number(highBid.toFixed(2))
        : lowBid !== null
        ? Number(lowBid.toFixed(2))
        : null;

    const rawComp = String(km.competition || '').toUpperCase();
    const competition =
      rawComp === 'HIGH' ? 'High' : rawComp === 'MEDIUM' ? 'Medium' : rawComp === 'LOW' ? 'Low' : null;

    out[kwText] = {
      keyword: item.text || kwText,
      searchVolume: Number.isFinite(vol) ? vol : null,
      cpc: cpc !== null && Number.isFinite(cpc) ? cpc : null,
      competition,
      competitionIndex: compIdx !== null && Number.isFinite(compIdx) ? compIdx : null,
      keywordDifficulty: null, // Google Ads API does not return organic SEO KD
      dataSource: 'google_ads',
    };
  }
  return out;
}

async function fetchDataForSeoMetrics(
  keywords: string[],
  countryCode: string,
  languageCode: string
): Promise<Record<string, VerifiedKeywordMetric>> {
  const login = process.env.DATAFORSEO_LOGIN!.trim();
  const password = process.env.DATAFORSEO_PASSWORD!.trim();
  const basic = Buffer.from(`${login}:${password}`).toString('base64');

  const countryInfo = COUNTRY_TARGETS[countryCode] || COUNTRY_TARGETS.US;
  const payload = [
    {
      keywords: keywords.slice(0, 60),
      language_code: (LANGUAGE_TARGETS[languageCode] || LANGUAGE_TARGETS.en).code,
      ...(countryInfo.dataForSeoLocationCode
        ? { location_code: countryInfo.dataForSeoLocationCode }
        : {}),
    },
  ];

  const res = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO returned HTTP ${res.status}.`);
  }

  const json = (await res.json()) as {
    tasks?: Array<{
      result?: Array<{
        keyword?: string;
        search_volume?: number | null;
        cpc?: number | null;
        competition?: string | null;
        competition_index?: number | null;
      }>;
    }>;
  };

  const out: Record<string, VerifiedKeywordMetric> = {};
  for (const row of json.tasks?.[0]?.result || []) {
    const kwText = String(row.keyword || '').trim().toLowerCase();
    if (!kwText) continue;
    const rawComp = String(row.competition || '').toUpperCase();
    const competition =
      rawComp === 'HIGH' ? 'High' : rawComp === 'MEDIUM' ? 'Medium' : rawComp === 'LOW' ? 'Low' : null;
    out[kwText] = {
      keyword: row.keyword || kwText,
      searchVolume: typeof row.search_volume === 'number' ? row.search_volume : null,
      cpc: typeof row.cpc === 'number' ? Number(row.cpc.toFixed(2)) : null,
      competition,
      competitionIndex: typeof row.competition_index === 'number' ? row.competition_index : null,
      keywordDifficulty: null,
      dataSource: 'dataforseo',
    };
  }
  return out;
}

export async function fetchVerifiedKeywordMetrics(
  keywords: string[],
  countryCode: string,
  languageCode: string
): Promise<{
  provider: 'google_ads' | 'dataforseo' | 'none';
  metrics: Record<string, VerifiedKeywordMetric>;
  notice: string;
}> {
  const uniqueKeywords = Array.from(
    new Set(keywords.map((k) => k.trim()).filter((k) => k.length > 0))
  ).slice(0, 60);

  if (uniqueKeywords.length === 0) {
    return { provider: 'none', metrics: {}, notice: 'No candidate keywords provided.' };
  }

  if (missingVars(GOOGLE_ADS_REQUIRED_VARS).length === 0) {
    try {
      const metrics = await fetchGoogleAdsHistoricalMetrics(uniqueKeywords, countryCode, languageCode);
      return {
        provider: 'google_ads',
        metrics,
        notice: 'Monthly search volume & CPC retrieved live from Google Ads Keyword Planner API.',
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Google Ads API lookup failed';
      return {
        provider: 'none',
        metrics: {},
        notice: `Google Ads API unavailable (${reason}). Numeric volume & CPC shown as Unavailable.`,
      };
    }
  }

  if (missingVars(DATAFORSEO_REQUIRED_VARS).length === 0) {
    try {
      const metrics = await fetchDataForSeoMetrics(uniqueKeywords, countryCode, languageCode);
      return {
        provider: 'dataforseo',
        metrics,
        notice: 'Monthly search volume & CPC retrieved live from DataForSEO Google Ads API.',
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'DataForSEO lookup failed';
      return {
        provider: 'none',
        metrics: {},
        notice: `DataForSEO unavailable (${reason}). Numeric volume & CPC shown as Unavailable.`,
      };
    }
  }

  return {
    provider: 'none',
    metrics: {},
    notice:
      'No verified keyword volume API (Google Ads Keyword Planner or DataForSEO) is configured on the server. Search Volume, CPC, and verified Keyword Difficulty are marked Unavailable rather than fabricated.',
  };
}
