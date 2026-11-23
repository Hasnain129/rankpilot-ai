import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import {
  fsCreateDoc,
  fsDeleteDoc,
  fsGetDoc,
  fsQueryByOwner,
  fsUpdateDoc,
  fsWriteSyncLog,
  getFirebaseConfig,
  requireFirebaseAuth,
} from './firebaseAuth.ts';
import { decryptSecrets, encryptSecrets, hasDedicatedEncryptionKey } from './cryptoVault.ts';
import {
  crawlEntireSite,
  inspectPageRaw,
  validatePublicHttpUrl,
} from './crawler.ts';
import {
  PSI_CACHE_TTL_MS,
  PageSpeedApiError,
  fetchPageSpeedWithCache,
  getPageSpeedKeyConfig,
  getPsiQuotaStatus,
  normalizePsiUrl,
} from './pagespeed.ts';
import {
  type DetectedSeoPlugin,
  type WpEntityType,
  type WpSecrets,
  importWordPressCatalog,
  pushChangeToWordPress,
  verifyWordPressConnection,
} from './wordpress.ts';
import {
  COUNTRY_TARGETS,
  LANGUAGE_TARGETS,
  fetchVerifiedKeywordMetrics,
  getKeywordProvidersStatus,
} from './keywordProviders.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractGeminiError(err: unknown): { status: number; message: string } {
  const rawMsg = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(rawMsg);
    const code = Number(parsed?.error?.code) || 500;
    const msg = String(parsed?.error?.message || rawMsg);
    return { status: code >= 400 && code < 600 ? code : 500, message: msg };
  } catch {
    if (rawMsg.includes('503') || rawMsg.toLowerCase().includes('unavailable')) {
      return {
        status: 503,
        message: 'AI model is temporarily experiencing high demand. Please try again in a moment.',
      };
    }
    if (rawMsg.includes('429') || rawMsg.toLowerCase().includes('resource_exhausted')) {
      return {
        status: 429,
        message: 'Gemini API rate limit reached. Please wait briefly and try again.',
      };
    }
    return { status: 500, message: rawMsg };
  }
}

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const { status } = extractGeminiError(err);
      const isTransient = status === 429 || status === 503 || status === 502;
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = 800 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

const rateBuckets = new Map<string, number[]>();
function createRateLimiter(limit: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    const uid = req.firebaseAuth?.uid || ip;
    const key = `${req.path}:${uid}`;
    const now = Date.now();
    const recent = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= limit) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    if (rateBuckets.size > 3000) rateBuckets.clear();
    next();
  };
}

function makeDocId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const aiLimiter = createRateLimiter(25, 60_000);

  // ---------------------------------------------------------------------------
  // 0. Health Endpoint (public, zero secrets)
  // ---------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    let firebaseMeta: { projectId: string; firestoreDatabaseId: string } | null = null;
    try {
      const cfg = getFirebaseConfig();
      firebaseMeta = {
        projectId: cfg.projectId,
        firestoreDatabaseId: cfg.firestoreDatabaseId,
      };
    } catch {
      firebaseMeta = null;
    }
    const psiKeyCfg = getPageSpeedKeyConfig();
    const psiQuota = getPsiQuotaStatus();
    res.json({
      ok: true,
      service: 'RankPilot AI',
      timestamp: new Date().toISOString(),
      firebase: firebaseMeta,
      capabilities: {
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        dedicatedVaultKey: hasDedicatedEncryptionKey(),
        pageSpeedKeyConfigured: Boolean(psiKeyCfg.apiKey),
        pageSpeedKeySource: psiKeyCfg.source,
        pageSpeedQuotaExhausted: psiQuota.quotaExhausted,
        pageSpeedQuotaRetryAfter: psiQuota.retryAfter,
        serpApiConfigured: Boolean(process.env.SERP_API_KEY),
      },
      keywordProviders: getKeywordProvidersStatus().map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
      })),
    });
  });

  app.get('/api/keywords/providers', requireFirebaseAuth, (_req, res) => {
    res.json({
      providers: getKeywordProvidersStatus(),
      countries: Object.values(COUNTRY_TARGETS).map((c) => ({ code: c.code, label: c.label })),
      languages: Object.values(LANGUAGE_TARGETS).map((l) => ({ code: l.code, label: l.label })),
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Protected Single-Page Technical Audit + AI Recommendations
  // ---------------------------------------------------------------------------
  app.post('/api/seo/analyze', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== 'string' || url.trim().length > 500) {
        res.status(400).json({ error: 'A valid website URL (max 500 chars) is required.' });
        return;
      }

      let inspected;
      try {
        inspected = await inspectPageRaw(url, 8);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error';
        const isClientErr =
          msg.includes('Private or loopback') ||
          msg.includes('restricted internal') ||
          msg.includes('Only http and https') ||
          msg.includes('Invalid URL');
        res.status(isClientErr ? 400 : 502).json({
          error: isClientErr ? msg : `Could not reach ${url}. Ensure the URL is publicly accessible (${msg}).`,
        });
        return;
      }

      const p = inspected.page;
      const issues: Array<{
        severity: 'critical' | 'warning' | 'passed';
        category: string;
        title: string;
        detail: string;
      }> = [];

      if (p.httpStatus >= 400 || p.httpStatus === 0) {
        issues.push({ severity: 'critical', category: 'Availability', title: `HTTP ${p.httpStatus} response`, detail: 'The page returned an HTTP error status code.' });
      } else {
        issues.push({ severity: 'passed', category: 'Availability', title: `HTTP ${p.httpStatus} OK`, detail: 'Page responded with a valid success status.' });
      }
      if (!p.title) {
        issues.push({ severity: 'critical', category: 'Meta Tags', title: 'Missing <title> tag', detail: 'Every indexable page requires a unique descriptive title tag.' });
      } else if (p.title.length < 20 || p.title.length > 65) {
        issues.push({ severity: 'warning', category: 'Meta Tags', title: `Title length (${p.title.length} chars)`, detail: 'Recommended page title length is between 30 and 60 characters.' });
      } else {
        issues.push({ severity: 'passed', category: 'Meta Tags', title: 'Title tag length optimal', detail: `Title is ${p.title.length} characters.` });
      }
      if (!p.metaDescription) {
        issues.push({ severity: 'critical', category: 'Meta Tags', title: 'Missing meta description', detail: 'Add a 120–155 character meta description to improve search CTR.' });
      } else if (p.metaDescription.length < 70 || p.metaDescription.length > 165) {
        issues.push({ severity: 'warning', category: 'Meta Tags', title: `Meta description length (${p.metaDescription.length} chars)`, detail: 'Aim for 120–160 characters so search snippets do not truncate.' });
      } else {
        issues.push({ severity: 'passed', category: 'Meta Tags', title: 'Meta description present', detail: `Length is ${p.metaDescription.length} characters.` });
      }
      if (p.h1Count === 0) {
        issues.push({ severity: 'critical', category: 'Headings', title: 'Missing H1 heading', detail: 'Include one primary H1 tag clearly describing the page topic.' });
      } else if (p.h1Count > 1) {
        issues.push({ severity: 'warning', category: 'Headings', title: `Multiple H1 tags detected (${p.h1Count})`, detail: 'Consolidate into a single primary H1 heading for clearer hierarchy.' });
      } else {
        issues.push({ severity: 'passed', category: 'Headings', title: 'Single H1 structure', detail: `Detected 1 H1, ${p.h2Count} H2, and ${p.h3Count} H3 headings.` });
      }
      if (p.missingAltCount > 0) {
        issues.push({ severity: 'warning', category: 'Accessibility & Images', title: `${p.missingAltCount} of ${p.totalImages} images missing alt text`, detail: 'Descriptive alt attributes help image search rankings and screen readers.' });
      } else if (p.totalImages > 0) {
        issues.push({ severity: 'passed', category: 'Accessibility & Images', title: 'All images have alt attributes', detail: `Checked ${p.totalImages} image elements.` });
      }
      issues.push(
        p.mobileFriendly
          ? { severity: 'passed', category: 'Mobile Readiness', title: 'Mobile viewport configured', detail: 'Responsive viewport meta tag detected.' }
          : { severity: 'critical', category: 'Mobile Readiness', title: 'Missing viewport meta tag', detail: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' }
      );
      issues.push(
        p.hasCanonical
          ? { severity: 'passed', category: 'Technical SEO', title: 'Canonical tag configured', detail: p.canonicalUrl }
          : { severity: 'warning', category: 'Technical SEO', title: 'Missing canonical link tag', detail: 'Set a rel="canonical" link to prevent duplicate URL indexing.' }
      );
      if (p.noindex) {
        issues.push({ severity: 'critical', category: 'Indexing', title: 'Robots noindex directive detected', detail: p.xRobotsTag ? `Blocked via meta/header (${p.metaRobots || p.xRobotsTag}).` : 'Search engines are instructed not to index this URL.' });
      }
      if (p.redirectCount > 0) {
        issues.push({ severity: 'warning', category: 'Technical SEO', title: `${p.redirectCount} HTTP redirect hop(s) before final URL`, detail: `Redirect chain: ${p.redirectChain.join(' -> ')}` });
      }
      if (p.schemaTypes.length > 0) {
        issues.push({ severity: 'passed', category: 'Structured Data', title: `JSON-LD Schema (${p.schemaTypes.join(', ')})`, detail: 'Structured data found on page.' });
      } else {
        issues.push({ severity: 'warning', category: 'Structured Data', title: 'No JSON-LD schema detected', detail: 'Add Product, FAQPage, or Article schema for rich search snippets.' });
      }
      if (p.brokenLinksCount > 0) {
        issues.push({ severity: 'critical', category: 'Links', title: `${p.brokenLinksCount} broken sampled link(s)`, detail: 'Fix or redirect dead outbound/internal links.' });
      }

      let recommendations: Array<{ priority: string; title: string; impact: string; actionSteps: string }> = [];
      let summary = `Technical scan completed for ${new URL(p.url).hostname} with a score of ${p.score}/100.`;

      try {
        const ai = getGeminiClient();
        const prompt = `Analyze these real crawled technical SEO metrics for ${p.url} and produce prioritized, concrete recommendations:
- Page Type: ${p.pageType}
- HTTP Status: ${p.httpStatus}
- HTML Load Time: ${p.loadTimeMs}ms
- Title: "${p.title}"
- Meta Description: "${p.metaDescription}"
- Primary H1: "${p.h1}" (H1=${p.h1Count}, H2=${p.h2Count}, H3=${p.h3Count})
- Word Count: ${p.wordCount}
- Images: ${p.totalImages} total, ${p.missingAltCount} missing alt
- Links: ${p.internalLinks} internal, ${p.externalLinks} external, ${p.brokenLinksCount} broken sampled
- Canonical: ${p.canonicalUrl || 'none'}, Noindex: ${p.noindex}, Schemas: ${p.schemaTypes.join(', ') || 'none'}
- Computed Score: ${p.score}/100

Provide a concise executive summary (max 2 sentences) and 4-6 specific actionable recommendations ordered by impact.`;

        const aiResponse = await callGeminiWithRetry(() =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              systemInstruction: 'You are a principal technical SEO engineer. Give specific, grounded advice based strictly on the provided crawl metrics.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  summary: { type: Type.STRING },
                  recommendations: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        priority: { type: Type.STRING },
                        title: { type: Type.STRING },
                        impact: { type: Type.STRING },
                        actionSteps: { type: Type.STRING },
                      },
                      required: ['priority', 'title', 'impact', 'actionSteps'],
                    },
                  },
                },
                required: ['summary', 'recommendations'],
              },
            },
          })
        );

        const parsed = JSON.parse(aiResponse.text || '{}');
        if (parsed.summary) summary = String(parsed.summary).slice(0, 1900);
        if (Array.isArray(parsed.recommendations)) {
          recommendations = parsed.recommendations.slice(0, 10);
        }
      } catch (aiErr) {
        console.error('Gemini SEO recommendation fallback:', aiErr);
        recommendations = [
          {
            priority: 'High',
            title: 'Address flagged technical SEO items',
            impact: 'Improves crawlability and search snippet CTR',
            actionSteps: 'Review missing meta tags, heading hierarchy, schema markup, and alt attributes in the technical audit table.',
          },
        ];
      }

      res.json({
        url: p.url,
        domain: new URL(p.url).hostname,
        score: p.score,
        loadTimeMs: p.loadTimeMs,
        httpStatus: p.httpStatus,
        title: p.title,
        metaDescription: p.metaDescription,
        h1Count: p.h1Count,
        h2Count: p.h2Count,
        h3Count: p.h3Count,
        wordCount: p.wordCount,
        totalImages: p.totalImages,
        missingAltCount: p.missingAltCount,
        internalLinks: p.internalLinks,
        externalLinks: p.externalLinks,
        brokenLinksCount: p.brokenLinksCount,
        brokenLinks: [],
        hasViewport: p.mobileFriendly,
        hasCanonical: p.hasCanonical,
        hasOpenGraph: true,
        mobileFriendly: p.mobileFriendly,
        redirectChain: p.redirectChain,
        redirectCount: p.redirectCount,
        metaRobots: p.metaRobots,
        xRobotsTag: p.xRobotsTag,
        issues: issues.slice(0, 30),
        recommendations: recommendations.slice(0, 20),
        summary,
      });
    } catch (err) {
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Phase 1: Full-Site Multi-Page SEO Crawler
  // ---------------------------------------------------------------------------
  app.post('/api/seo/crawl-site', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { websiteId, rootUrl, maxPages = 15 } = req.body as {
        websiteId?: string;
        rootUrl?: string;
        maxPages?: number;
      };
      if (!websiteId || !rootUrl) {
        res.status(400).json({ error: 'websiteId and rootUrl are required.' });
        return;
      }

      const auth = req.firebaseAuth!;
      const siteCrawl = await crawlEntireSite({ rootUrl, maxPages });
      const crawlId = makeDocId('crawl');

      await fsCreateDoc(
        auth.idToken,
        'siteCrawls',
        crawlId,
        {
          ownerId: auth.uid,
          websiteId,
          rootUrl: siteCrawl.rootUrl,
          pagesCrawled: siteCrawl.pagesCrawled,
          overallScore: siteCrawl.overallScore,
          robotsTxtFound: siteCrawl.robotsTxtFound,
          robotsBlockingAll: siteCrawl.robotsBlockingAll,
          sitemapFound: siteCrawl.sitemapFound,
          sitemapUrlsCount: siteCrawl.sitemapUrlsCount,
          duplicateTitlesCount: siteCrawl.duplicateTitlesCount,
          duplicateMetaCount: siteCrawl.duplicateMetaCount,
          noindexCount: siteCrawl.noindexCount,
          brokenLinksCount: siteCrawl.brokenLinksCount,
          pages: siteCrawl.pages,
          siteIssues: siteCrawl.siteIssues,
          summary: siteCrawl.summary,
        },
        ['createdAt']
      );

      await fsUpdateDoc(
        auth.idToken,
        'websites',
        websiteId,
        {
          seoScore: siteCrawl.overallScore,
          pagesScanned: siteCrawl.pagesCrawled,
          lastScannedAt: new Date().toISOString().slice(0, 64),
        },
        true
      ).catch(() => {});

      await fsWriteSyncLog(auth, {
        websiteId,
        channel: 'crawler',
        action: `Full-site crawl (${siteCrawl.pagesCrawled} pages)`,
        status: 'success',
        detail: siteCrawl.summary,
      });

      res.json({ id: crawlId, ...siteCrawl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Full-site crawl failed.';
      const status = msg.includes('Private or loopback') || msg.includes('restricted') || msg.includes('Only http') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Advanced Keyword Research + Modular Verified Metrics Enrichment (Protected)
  // ---------------------------------------------------------------------------
  app.post('/api/ai/keywords', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const {
        seedKeyword,
        sourceType = 'keyword',
        targetUrl = '',
        country = 'US',
        language = 'en',
        intentFilter = 'All',
        targetMarket = '',
        websiteUrl = '',
      } = req.body as {
        seedKeyword?: string;
        sourceType?: 'keyword' | 'product' | 'url' | 'category';
        targetUrl?: string;
        country?: string;
        language?: string;
        intentFilter?: string;
        targetMarket?: string;
        websiteUrl?: string;
      };

      const cleanCountry = COUNTRY_TARGETS[String(country).toUpperCase()]
        ? String(country).toUpperCase()
        : 'US';
      const cleanLanguage = LANGUAGE_TARGETS[String(language).toLowerCase()]
        ? String(language).toLowerCase()
        : 'en';
      const countryInfo = COUNTRY_TARGETS[cleanCountry];
      const langInfo = LANGUAGE_TARGETS[cleanLanguage];
      const resolvedMarket =
        targetMarket?.trim() || `${countryInfo.label} / ${langInfo.label}`;

      let cleanSeed = typeof seedKeyword === 'string' ? seedKeyword.trim() : '';
      let crawledUrlContext = '';
      const inspectTarget =
        (targetUrl && targetUrl.trim()) ||
        (sourceType === 'url' && /^https?:\/\//i.test(cleanSeed) ? cleanSeed : '');

      if (inspectTarget) {
        try {
          const inspected = await inspectPageRaw(inspectTarget, 0);
          const p = inspected.page;
          crawledUrlContext = `\nLive Crawled Page Context (${p.url}):
- Title: "${p.title}"
- H1: "${p.h1}"
- Meta Description: "${p.metaDescription}"
- Excerpt: "${p.bodyExcerpt.slice(0, 900)}"`;
          if (!cleanSeed || /^https?:\/\//i.test(cleanSeed)) {
            cleanSeed = (p.title || p.h1 || new URL(p.url).hostname).slice(0, 150);
          }
        } catch (crawlErr) {
          const msg = crawlErr instanceof Error ? crawlErr.message : 'Unable to crawl target URL';
          if (sourceType === 'url') {
            res.status(400).json({ error: `Could not inspect target URL: ${msg}` });
            return;
          }
        }
      }

      if (!cleanSeed || cleanSeed.length < 2 || cleanSeed.length > 160) {
        res.status(400).json({ error: 'Please provide a seed keyword, product name, or public URL (2–160 chars).' });
        return;
      }

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Perform comprehensive SEO keyword discovery for:
Seed / Topic (${sourceType}): "${cleanSeed}"
Target Country: ${countryInfo.label} (${cleanCountry})
Language: ${langInfo.label} (${cleanLanguage})
Requested Intent Focus: ${String(intentFilter || 'All').slice(0, 40)}
${websiteUrl ? `Website Context: ${String(websiteUrl).slice(0, 300)}` : ''}
${crawledUrlContext}

Requirements:
1. Generate 6-8 core related keywords, 6-8 specific long-tail keywords, 5 question keywords (how/what/best/why/which), 5 commercial/buying-intent keywords (buy/price/review/near me/best), and 5 variations/synonyms tailored to ${countryInfo.label} (${langInfo.label}).
2. Classify each term's Search Intent accurately (Commercial, Transactional, Informational, Navigational), funnel stage (TOFU/MOFU/BOFU), AI Competition Estimate (Low (AI Est.) / Medium (AI Est.) / High (AI Est.)), and Opportunity Tier (AI High Opportunity / AI Medium Opportunity / AI Niche Opportunity).
3. Group into 3-5 topical Keyword Clusters with recommendedPrimaryKeyword, suggestedAssetType (product | category | blog | landing), and cannibalizationRisk (Low | Medium | High).
4. Provide 4-6 strategic keyword opportunities categorized strictly as bucket: "low_competition_candidate" | "commercial_buying" | "ecommerce_priority" | "informational_blog".
5. CRITICAL: NEVER invent fake monthly search volumes, fake CPC values, or fake numeric difficulty scores.`,
          config: {
            systemInstruction:
              'You are a principal international SEO strategist specializing in ecommerce, SaaS, and regional search intent. Return structured keyword intelligence and never fabricate numeric volumes or rankings.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                relatedKeywords: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      keyword: { type: Type.STRING },
                      intent: { type: Type.STRING },
                      competitionEstimate: { type: Type.STRING },
                      opportunityTier: { type: Type.STRING },
                      rationale: { type: Type.STRING },
                    },
                    required: ['keyword', 'intent', 'competitionEstimate', 'opportunityTier', 'rationale'],
                  },
                },
                longTailKeywords: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      keyword: { type: Type.STRING },
                      intent: { type: Type.STRING },
                      funnelStage: { type: Type.STRING },
                      competitionEstimate: { type: Type.STRING },
                      opportunityTier: { type: Type.STRING },
                    },
                    required: ['keyword', 'intent', 'funnelStage', 'competitionEstimate', 'opportunityTier'],
                  },
                },
                questionKeywords: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      keyword: { type: Type.STRING },
                      intent: { type: Type.STRING },
                      rationale: { type: Type.STRING },
                    },
                    required: ['keyword', 'intent', 'rationale'],
                  },
                },
                commercialKeywords: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      keyword: { type: Type.STRING },
                      intent: { type: Type.STRING },
                      competitionEstimate: { type: Type.STRING },
                      rationale: { type: Type.STRING },
                    },
                    required: ['keyword', 'intent', 'competitionEstimate', 'rationale'],
                  },
                },
                synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
                clusters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      clusterName: { type: Type.STRING },
                      pillarTopic: { type: Type.STRING },
                      recommendedPrimaryKeyword: { type: Type.STRING },
                      suggestedAssetType: { type: Type.STRING },
                      cannibalizationRisk: { type: Type.STRING },
                      keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: [
                      'clusterName',
                      'pillarTopic',
                      'recommendedPrimaryKeyword',
                      'suggestedAssetType',
                      'cannibalizationRisk',
                      'keywords',
                    ],
                  },
                },
                opportunities: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      keyword: { type: Type.STRING },
                      bucket: { type: Type.STRING },
                      intent: { type: Type.STRING },
                      whyItWins: { type: Type.STRING },
                      recommendedAssetType: { type: Type.STRING },
                    },
                    required: ['keyword', 'bucket', 'intent', 'whyItWins', 'recommendedAssetType'],
                  },
                },
                contentIdeas: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      format: { type: Type.STRING },
                      targetKeyword: { type: Type.STRING },
                      angle: { type: Type.STRING },
                    },
                    required: ['title', 'format', 'targetKeyword', 'angle'],
                  },
                },
                suggestedTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: [
                'relatedKeywords',
                'longTailKeywords',
                'questionKeywords',
                'commercialKeywords',
                'synonyms',
                'clusters',
                'opportunities',
                'contentIdeas',
                'suggestedTitles',
              ],
            },
          },
        })
      );

      const parsed = JSON.parse(response.text || '{}');

      // Normalize into unified keywordItems list (deduplicated)
      const itemMap = new Map<
        string,
        {
          keyword: string;
          category: 'related' | 'long_tail' | 'question' | 'commercial' | 'synonym';
          intent: string;
          competitionEstimate: string;
          opportunityTier: string;
          funnelStage?: string;
          rationale: string;
        }
      >();

      const pushCandidate = (
        kw: string,
        category: 'related' | 'long_tail' | 'question' | 'commercial' | 'synonym',
        intent: string,
        competitionEstimate: string,
        opportunityTier: string,
        rationale: string,
        funnelStage?: string
      ) => {
        const cleanKw = String(kw || '').trim();
        if (!cleanKw) return;
        const norm = cleanKw.toLowerCase();
        if (!itemMap.has(norm)) {
          itemMap.set(norm, {
            keyword: cleanKw.slice(0, 180),
            category,
            intent: String(intent || 'Commercial').slice(0, 40),
            competitionEstimate: String(competitionEstimate || 'Medium (AI Est.)').slice(0, 40),
            opportunityTier: String(opportunityTier || 'AI Medium Opportunity').slice(0, 40),
            funnelStage: funnelStage ? String(funnelStage).slice(0, 20) : undefined,
            rationale: String(rationale || '').slice(0, 260),
          });
        }
      };

      (parsed.relatedKeywords || []).forEach(
        (r: { keyword: string; intent: string; competitionEstimate: string; opportunityTier?: string; rationale: string }) =>
          pushCandidate(
            r.keyword,
            'related',
            r.intent,
            r.competitionEstimate,
            r.opportunityTier || 'AI Medium Opportunity',
            r.rationale,
            'MOFU'
          )
      );
      (parsed.longTailKeywords || []).forEach(
        (lt: { keyword: string; intent: string; funnelStage: string; competitionEstimate?: string; opportunityTier?: string }) =>
          pushCandidate(
            lt.keyword,
            'long_tail',
            lt.intent,
            lt.competitionEstimate || 'Low (AI Est.)',
            lt.opportunityTier || 'AI High Opportunity',
            `Long-tail ${lt.funnelStage || 'MOFU'} search query`,
            lt.funnelStage
          )
      );
      (parsed.questionKeywords || []).forEach(
        (q: { keyword: string; intent: string; rationale: string }) =>
          pushCandidate(
            q.keyword,
            'question',
            q.intent || 'Informational',
            'Low (AI Est.)',
            'AI High Opportunity',
            q.rationale || 'High-clarity buyer question query',
            'TOFU'
          )
      );
      (parsed.commercialKeywords || []).forEach(
        (c: { keyword: string; intent: string; competitionEstimate?: string; rationale: string }) =>
          pushCandidate(
            c.keyword,
            'commercial',
            c.intent || 'Transactional',
            c.competitionEstimate || 'Medium (AI Est.)',
            'AI High Opportunity',
            c.rationale || 'Commercial buying-intent query',
            'BOFU'
          )
      );
      (parsed.synonyms || []).forEach((s: string) =>
        pushCandidate(
          s,
          'synonym',
          'Commercial',
          'Medium (AI Est.)',
          'AI Medium Opportunity',
          'Semantic keyword variation & synonym',
          'MOFU'
        )
      );

      const candidateList = Array.from(itemMap.values()).slice(0, 50);
      const verifiedLookup = await fetchVerifiedKeywordMetrics(
        candidateList.map((c) => c.keyword),
        cleanCountry,
        cleanLanguage
      );

      const keywordItems = candidateList.map((item) => {
        const verified = verifiedLookup.metrics[item.keyword.toLowerCase()];
        const searchVolume = verified ? verified.searchVolume : null;
        const cpc = verified ? verified.cpc : null;
        const competition = verified ? verified.competition : null;
        const keywordDifficulty = verified ? verified.keywordDifficulty : null;

        // Compute Opportunity Score ONLY from verified numerical volume & competition index
        let opportunityScore: number | null = null;
        if (verified && typeof verified.searchVolume === 'number' && verified.searchVolume > 0) {
          const compPenalty =
            typeof verified.competitionIndex === 'number'
              ? verified.competitionIndex * 0.55
              : competition === 'High'
              ? 60
              : competition === 'Medium'
              ? 35
              : 15;
          const volScore = Math.min(100, Math.round(Math.log10(verified.searchVolume + 1) * 20));
          opportunityScore = Math.max(5, Math.min(99, Math.round(volScore * 0.65 + (100 - compPenalty) * 0.35)));
        }

        return {
          keyword: item.keyword,
          category: item.category,
          intent: item.intent,
          country: cleanCountry,
          language: cleanLanguage,
          searchVolume,
          keywordDifficulty,
          cpc,
          competition,
          competitionEstimate: item.competitionEstimate,
          opportunityScore,
          opportunityTier: verified && opportunityScore !== null ? 'Verified' : item.opportunityTier,
          funnelStage: item.funnelStage || 'MOFU',
          rationale: item.rationale,
          dataSource: verified ? verified.dataSource : ('ai_estimate' as const),
        };
      });

      const allowedBuckets = new Set([
        'low_competition_candidate',
        'commercial_buying',
        'ecommerce_priority',
        'informational_blog',
      ]);
      const cleanOpportunities = (Array.isArray(parsed.opportunities) ? parsed.opportunities : [])
        .slice(0, 15)
        .map((o: { keyword?: string; bucket?: string; intent?: string; whyItWins?: string; recommendedAssetType?: string }) => ({
          keyword: String(o.keyword || '').slice(0, 160),
          bucket: (allowedBuckets.has(String(o.bucket)) ? o.bucket : 'commercial_buying') as
            | 'low_competition_candidate'
            | 'commercial_buying'
            | 'ecommerce_priority'
            | 'informational_blog',
          intent: String(o.intent || 'Commercial').slice(0, 40),
          whyItWins: String(o.whyItWins || '').slice(0, 320),
          recommendedAssetType: String(o.recommendedAssetType || 'landing').slice(0, 40),
          isVerifiedMetric: verifiedLookup.provider !== 'none',
        }));

      res.json({
        seedKeyword: cleanSeed,
        targetMarket: resolvedMarket.slice(0, 80),
        country: cleanCountry,
        language: cleanLanguage,
        sourceType,
        targetUrl: inspectTarget.slice(0, 500),
        relatedKeywords: (parsed.relatedKeywords || []).slice(0, 20),
        longTailKeywords: (parsed.longTailKeywords || []).slice(0, 20),
        keywordItems,
        synonyms: (Array.isArray(parsed.synonyms) ? parsed.synonyms : []).slice(0, 20),
        opportunities: cleanOpportunities,
        dataNotice: verifiedLookup.notice,
        clusters: (parsed.clusters || []).slice(0, 12),
        contentIdeas: (parsed.contentIdeas || []).slice(0, 12),
        suggestedTitles: (parsed.suggestedTitles || []).slice(0, 12),
      });
    } catch (err) {
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Phase 2: Page/Product/WooCommerce Keyword Mapping + Cannibalization Analysis
  // ---------------------------------------------------------------------------
  app.post('/api/ai/keyword-map', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { websiteDomain, targetMarket = 'United States / English', pages } = req.body as {
        websiteDomain?: string;
        targetMarket?: string;
        pages?: Array<{
          url: string;
          title: string;
          pageType: string;
          existingKeyword?: string;
          shortDescription?: string;
        }>;
      };

      if (!Array.isArray(pages) || pages.length === 0) {
        res.status(400).json({ error: 'Provide at least 1 crawled page or WordPress/WooCommerce entity to map keywords.' });
        return;
      }

      const slice = pages.slice(0, 25);
      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Analyze this inventory of pages, WooCommerce products, and categories on ${String(websiteDomain || 'the website').slice(0, 200)} (Market: ${targetMarket}).
For each item:
1. Recommend 1 unique primary target keyword and 2-3 secondary/long-tail supporting keywords tailored to its product name, description, and category.
2. Classify search intent (Transactional, Commercial, Informational, Navigational).
3. Estimate AI competition tier (Low / Medium / High — AI estimate only, DO NOT invent monthly search volume or exact rank numbers).
4. Detect duplicate keyword targeting and keyword cannibalization where multiple URLs compete for the same primary topic/intent, and advise how to differentiate canonical targets or reassign keywords.

Pages / Catalog Items:
${slice
  .map(
    (p, i) =>
      `${i + 1}. [${p.pageType}] URL: ${p.url} | Title: "${p.title}" | Focus Keyword: "${p.existingKeyword || 'none'}"${
        p.shortDescription ? ` | Summary: "${String(p.shortDescription).replace(/<[^>]+>/g, ' ').slice(0, 160)}"` : ''
      }`
  )
  .join('\n')}`,
          config: {
            systemInstruction:
              'You are an enterprise e-commerce & WooCommerce SEO architect. Assign non-overlapping primary keywords per product/category/page and detect cannibalization without inventing search volume or ranking figures.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                mappings: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      url: { type: Type.STRING },
                      pageType: { type: Type.STRING },
                      primaryKeyword: { type: Type.STRING },
                      longTailKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                      searchIntent: { type: Type.STRING },
                      competitionEstimate: { type: Type.STRING },
                      opportunityNote: { type: Type.STRING },
                    },
                    required: [
                      'url',
                      'pageType',
                      'primaryKeyword',
                      'longTailKeywords',
                      'searchIntent',
                      'competitionEstimate',
                      'opportunityNote',
                    ],
                  },
                },
                cannibalizationAlerts: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      competingTopic: { type: Type.STRING },
                      urls: { type: Type.ARRAY, items: { type: Type.STRING } },
                      severity: { type: Type.STRING },
                      resolutionAdvice: { type: Type.STRING },
                    },
                    required: ['competingTopic', 'urls', 'severity', 'resolutionAdvice'],
                  },
                },
              },
              required: ['mappings', 'cannibalizationAlerts'],
            },
          },
        })
      );

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        mappings: Array.isArray(parsed.mappings) ? parsed.mappings : [],
        cannibalizationAlerts: Array.isArray(parsed.cannibalizationAlerts)
          ? parsed.cannibalizationAlerts
          : [],
        dataNotice:
          'Intent & competition tiers are AI-estimated. Connect Google Search Console or a verified volume provider for live metrics.',
      });
    } catch (err) {
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 4b. Competitor URL Keyword Extraction & Content Gap Analysis (Protected, SSRF-Safe)
  // ---------------------------------------------------------------------------
  app.post('/api/ai/keyword-competitor', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { urls, country = 'US', language = 'en', ownDomain = '' } = req.body as {
        urls?: string[];
        country?: string;
        language?: string;
        ownDomain?: string;
      };

      if (!Array.isArray(urls) || urls.length === 0) {
        res.status(400).json({ error: 'Provide 1 to 3 public competitor URLs to inspect.' });
        return;
      }

      const targetUrls = urls
        .map((u) => String(u || '').trim())
        .filter((u) => u.length > 0)
        .slice(0, 3);

      const crawledPages: Array<{
        url: string;
        title: string;
        metaDescription: string;
        h1: string;
        wordCount: number;
        excerpt: string;
        error?: string;
      }> = [];

      for (const rawUrl of targetUrls) {
        try {
          const inspected = await inspectPageRaw(rawUrl, 0);
          const p = inspected.page;
          crawledPages.push({
            url: p.url,
            title: p.title,
            metaDescription: p.metaDescription,
            h1: p.h1,
            wordCount: p.wordCount,
            excerpt: p.bodyExcerpt.slice(0, 1200),
          });
        } catch (err) {
          crawledPages.push({
            url: rawUrl,
            title: '',
            metaDescription: '',
            h1: '',
            wordCount: 0,
            excerpt: '',
            error: err instanceof Error ? err.message : 'Unable to crawl competitor URL.',
          });
        }
      }

      const reachable = crawledPages.filter((c) => !c.error);
      if (reachable.length === 0) {
        res.status(400).json({
          error:
            crawledPages[0]?.error ||
            'Could not reach any supplied competitor URLs. Ensure they are public http/https pages.',
        });
        return;
      }

      const countryLabel = COUNTRY_TARGETS[country.toUpperCase()]?.label || country;
      const langLabel = LANGUAGE_TARGETS[language.toLowerCase()]?.label || language;

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Analyze these publicly crawled competitor pages (Market: ${countryLabel} / ${langLabel}${
            ownDomain ? `, Comparing for website: ${ownDomain}` : ''
          }):

${reachable
  .map(
    (c, i) => `Competitor ${i + 1}: ${c.url}
- Title: "${c.title}"
- H1: "${c.h1}"
- Meta Description: "${c.metaDescription}"
- Word Count: ${c.wordCount}
- Copy Excerpt: "${c.excerpt}"`
  )
  .join('\n\n')}

Extract:
1. 10-15 concrete target keywords and buyer phrases clearly evidenced in these competitor titles, headings, and copy (categorize opportunityType as "Product/Service" | "Category" | "Comparison" | "Informational Guide" and recommendedTargetAsset as "product" | "category" | "blog" | "landing").
2. 4-6 content gap angles we can build stronger pages around.
CRITICAL: NEVER claim or guess the competitor's Google ranking positions, organic traffic, or monthly search volume.`,
          config: {
            systemInstruction:
              'You are a competitive SEO researcher. Extract keyword themes strictly from actual crawled page text; never fabricate competitor traffic or Google rank positions.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                discoveredKeywords: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      keyword: { type: Type.STRING },
                      intent: { type: Type.STRING },
                      foundOnUrl: { type: Type.STRING },
                      opportunityType: { type: Type.STRING },
                      recommendedTargetAsset: { type: Type.STRING },
                      rationale: { type: Type.STRING },
                    },
                    required: [
                      'keyword',
                      'intent',
                      'foundOnUrl',
                      'opportunityType',
                      'recommendedTargetAsset',
                      'rationale',
                    ],
                  },
                },
                contentGaps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      topic: { type: Type.STRING },
                      competitorAngle: { type: Type.STRING },
                      suggestedTitle: { type: Type.STRING },
                      targetKeyword: { type: Type.STRING },
                    },
                    required: ['topic', 'competitorAngle', 'suggestedTitle', 'targetKeyword'],
                  },
                },
              },
              required: ['discoveredKeywords', 'contentGaps'],
            },
          },
        })
      );

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        crawledPages: crawledPages.map(({ excerpt: _ex, ...rest }) => rest),
        discoveredKeywords: (Array.isArray(parsed.discoveredKeywords) ? parsed.discoveredKeywords : []).slice(0, 20),
        contentGaps: (Array.isArray(parsed.contentGaps) ? parsed.contentGaps : []).slice(0, 10),
        dataNotice:
          'Competitor headings and on-page text were crawled live. Actual Google ranking positions, search volumes, and organic traffic are unavailable without a connected SEO/SERP data provider.',
      });
    } catch (err) {
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Phase 3: AI Optimization Center Draft Generator (Approval Required!)
  // ---------------------------------------------------------------------------
  app.post('/api/ai/optimize', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const {
        entityType,
        targetUrl,
        targetKeyword = '',
        currentTitle = '',
        currentDescription = '',
        currentShortDescription = '',
        currentSeoTitle = '',
        currentSeoDescription = '',
        missingAltCount = 0,
        siteInventory = [],
      } = req.body as {
        entityType?: string;
        targetUrl?: string;
        targetKeyword?: string;
        currentTitle?: string;
        currentDescription?: string;
        currentShortDescription?: string;
        currentSeoTitle?: string;
        currentSeoDescription?: string;
        missingAltCount?: number;
        siteInventory?: Array<{ title: string; url: string }>;
      };

      if (!targetUrl) {
        res.status(400).json({ error: 'targetUrl is required.' });
        return;
      }

      // Optionally enrich context by inspecting live URL if no rich body supplied
      let liveExcerpt = '';
      let liveH1 = '';
      let missingImgSample: string[] = [];
      try {
        const raw = await inspectPageRaw(targetUrl, 0);
        liveExcerpt = raw.page.bodyExcerpt;
        liveH1 = raw.page.h1;
        missingImgSample = raw.page.imageAltsMissingSample;
      } catch {
        // fallback cleanly to provided fields
      }

      const inventoryList = (siteInventory || []).slice(0, 15);
      const ai = getGeminiClient();

      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Create a conversion-oriented, search-optimized SEO upgrade package for this ${entityType || 'page'}:
URL: ${targetUrl}
Target Keyword: "${targetKeyword || currentTitle}"
Current Title / Name: "${currentTitle}"
Current H1: "${liveH1}"
Current SEO Meta Title: "${currentSeoTitle}"
Current SEO Meta Description: "${currentSeoDescription}"
Current Short Description / Excerpt: "${String(currentShortDescription).slice(0, 800)}"
Current Body / Description HTML/Text: "${String(currentDescription || liveExcerpt).slice(0, 2200)}"
Missing Alt Images Count: ${missingAltCount} (samples: ${missingImgSample.join(', ') || 'none'})

Available Internal Pages on this Website (ONLY suggest internal links using exact URLs from this list):
${inventoryList.map((item) => `- ${item.title}: ${item.url}`).join('\n') || 'None supplied'}

Requirements:
- Keep seoTitle 50-60 chars and seoDescription 135-155 chars.
- Produce clean HTML/copy for optimizedDescription with logical H2 subheadings, clear value props, and natural keyword placement.
- Suggest up to 3 image alt attributes if images lack alt text.
- Suggest up to 4 internal links ONLY from the supplied Available Internal Pages list (or empty array if none supplied).
- Generate 3 concise, high-intent FAQs and valid JSON-LD FAQPage schema string.`,
          config: {
            systemInstruction: 'You are an expert e-commerce and SaaS on-page SEO specialist. Never hallucinate internal URLs outside the supplied site inventory.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                focusKeyword: { type: Type.STRING },
                optimizedTitle: { type: Type.STRING },
                optimizedSeoTitle: { type: Type.STRING },
                optimizedSeoDescription: { type: Type.STRING },
                optimizedShortDescription: { type: Type.STRING },
                optimizedDescription: { type: Type.STRING },
                headingSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                imageAltSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                internalLinksSuggested: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      anchorText: { type: Type.STRING },
                      targetUrl: { type: Type.STRING },
                      reason: { type: Type.STRING },
                    },
                    required: ['anchorText', 'targetUrl', 'reason'],
                  },
                },
                faqs: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      answer: { type: Type.STRING },
                    },
                    required: ['question', 'answer'],
                  },
                },
                aiNotes: { type: Type.STRING },
              },
              required: [
                'focusKeyword',
                'optimizedTitle',
                'optimizedSeoTitle',
                'optimizedSeoDescription',
                'optimizedShortDescription',
                'optimizedDescription',
                'headingSuggestions',
                'imageAltSuggestions',
                'internalLinksSuggested',
                'faqs',
                'aiNotes',
              ],
            },
          },
        })
      );

      const parsed = JSON.parse(response.text || '{}');
      const allowedUrls = new Set(inventoryList.map((i) => i.url));
      const groundedLinks = Array.isArray(parsed.internalLinksSuggested)
        ? parsed.internalLinksSuggested
            .filter((l: { targetUrl?: string }) => l?.targetUrl && allowedUrls.has(l.targetUrl))
            .slice(0, 6)
        : [];

      const faqs = Array.isArray(parsed.faqs) ? parsed.faqs.slice(0, 5) : [];
      const faqSchemaObj =
        faqs.length > 0
          ? {
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: faqs.map((f: { question: string; answer: string }) => ({
                '@type': 'Question',
                name: f.question,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: f.answer,
                },
              })),
            }
          : null;

      res.json({
        focusKeyword: String(parsed.focusKeyword || targetKeyword || '').slice(0, 200),
        optimizedDraft: {
          title: String(parsed.optimizedTitle || currentTitle).slice(0, 300),
          seoTitle: String(parsed.optimizedSeoTitle || '').slice(0, 300),
          seoDescription: String(parsed.optimizedSeoDescription || '').slice(0, 600),
          shortDescription: String(parsed.optimizedShortDescription || '').slice(0, 5000),
          description: String(parsed.optimizedDescription || '').slice(0, 20000),
          headingSuggestions: Array.isArray(parsed.headingSuggestions)
            ? parsed.headingSuggestions.slice(0, 8)
            : [],
          imageAltSuggestions: Array.isArray(parsed.imageAltSuggestions)
            ? parsed.imageAltSuggestions.slice(0, 8)
            : [],
        },
        internalLinksSuggested: groundedLinks,
        faqSchemaJson: faqSchemaObj ? JSON.stringify(faqSchemaObj, null, 2).slice(0, 12000) : '',
        aiNotes: String(parsed.aiNotes || '').slice(0, 2000),
      });
    } catch (err) {
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Phase 4: WordPress & WooCommerce Secure REST Integration
  // ---------------------------------------------------------------------------
  app.post('/api/wordpress/connect', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const {
        websiteId,
        siteUrl,
        wpUsername = '',
        wpAppPassword = '',
        wcConsumerKey = '',
        wcConsumerSecret = '',
      } = req.body as {
        websiteId?: string;
        siteUrl?: string;
        wpUsername?: string;
        wpAppPassword?: string;
        wcConsumerKey?: string;
        wcConsumerSecret?: string;
      };

      if (!websiteId || !siteUrl) {
        res.status(400).json({ error: 'websiteId and siteUrl are required.' });
        return;
      }

      const auth = req.firebaseAuth!;
      const existingConn = await fsGetDoc<{
        encryptedSecrets?: string;
        wpUsername?: string;
      }>(auth.idToken, 'wpConnections', websiteId);

      let prevSecrets: WpSecrets = {
        wpUsername: '',
        wpAppPassword: '',
        wcConsumerKey: '',
        wcConsumerSecret: '',
      };
      if (existingConn?.encryptedSecrets) {
        try {
          prevSecrets = decryptSecrets<WpSecrets>(existingConn.encryptedSecrets);
        } catch {
          // ignore corrupted previous cipher
        }
      }

      const mergedSecrets: WpSecrets = {
        wpUsername: (wpUsername || prevSecrets.wpUsername || '').trim(),
        wpAppPassword: (wpAppPassword || prevSecrets.wpAppPassword || '').trim(),
        wcConsumerKey: (wcConsumerKey || prevSecrets.wcConsumerKey || '').trim(),
        wcConsumerSecret: (wcConsumerSecret || prevSecrets.wcConsumerSecret || '').trim(),
      };

      const check = await verifyWordPressConnection({
        siteUrl,
        secrets: mergedSecrets,
      });

      const encrypted = encryptSecrets(mergedSecrets as unknown as Record<string, string>);
      const nowIso = new Date().toISOString().slice(0, 64);

      const connPayload = {
        ownerId: auth.uid,
        websiteId,
        siteUrl: check.normalizedSiteUrl.slice(0, 500),
        wpUsername: mergedSecrets.wpUsername.slice(0, 120),
        seoPlugin: check.seoPlugin,
        hasWpAppPassword: Boolean(mergedSecrets.wpUsername && mergedSecrets.wpAppPassword),
        hasWcKeys: Boolean(mergedSecrets.wcConsumerKey && mergedSecrets.wcConsumerSecret),
        encryptedSecrets: encrypted,
        status: 'connected',
        lastSyncAt: nowIso,
        syncMessage: check.message.slice(0, 500),
      };

      if (existingConn) {
        await fsUpdateDoc(auth.idToken, 'wpConnections', websiteId, {
          siteUrl: connPayload.siteUrl,
          wpUsername: connPayload.wpUsername,
          seoPlugin: connPayload.seoPlugin,
          hasWpAppPassword: connPayload.hasWpAppPassword,
          hasWcKeys: connPayload.hasWcKeys,
          encryptedSecrets: connPayload.encryptedSecrets,
          status: connPayload.status,
          lastSyncAt: connPayload.lastSyncAt,
          syncMessage: connPayload.syncMessage,
        });
      } else {
        await fsCreateDoc(auth.idToken, 'wpConnections', websiteId, connPayload, [
          'createdAt',
          'updatedAt',
        ]);
      }

      await fsWriteSyncLog(auth, {
        websiteId,
        channel: check.wcVerified ? 'woocommerce' : 'wordpress',
        action: 'Verify & save connection',
        status: 'success',
        detail: check.message,
      });

      res.json({
        connected: true,
        siteUrl: connPayload.siteUrl,
        seoPlugin: check.seoPlugin,
        wpVerified: check.wpVerified,
        wcVerified: check.wcVerified,
        message: check.message,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WordPress connection failed.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/wordpress/import', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { websiteId } = req.body as { websiteId?: string };
      if (!websiteId) {
        res.status(400).json({ error: 'websiteId is required.' });
        return;
      }

      const auth = req.firebaseAuth!;
      const conn = await fsGetDoc<{
        siteUrl: string;
        encryptedSecrets: string;
        seoPlugin: DetectedSeoPlugin;
      }>(auth.idToken, 'wpConnections', websiteId);

      if (!conn || !conn.encryptedSecrets) {
        res.status(404).json({ error: 'WordPress/WooCommerce connection not configured for this website.' });
        return;
      }

      const secrets = decryptSecrets<WpSecrets>(conn.encryptedSecrets);
      const { entities, warnings } = await importWordPressCatalog({
        siteUrl: conn.siteUrl,
        secrets,
        preferredPlugin: conn.seoPlugin || 'none',
      });

      const nowIso = new Date().toISOString().slice(0, 64);
      let importedCount = 0;

      for (const entity of entities.slice(0, 60)) {
        const docId = `wpe_${websiteId}_${entity.entityType}_${entity.remoteId}`.slice(0, 128);
        const existing = await fsGetDoc(auth.idToken, 'wpEntities', docId);
        const mutableFields = {
          title: entity.title,
          slug: entity.slug,
          url: entity.url,
          status: entity.status,
          description: entity.description,
          shortDescription: entity.shortDescription,
          seoTitle: entity.seoTitle,
          seoDescription: entity.seoDescription,
          focusKeyword: entity.focusKeyword,
          seoPlugin: entity.seoPlugin,
          imagesCount: Math.trunc(entity.imagesCount),
          missingAltCount: Math.trunc(entity.missingAltCount),
          lastImportedAt: nowIso,
        };

        if (existing) {
          await fsUpdateDoc(auth.idToken, 'wpEntities', docId, mutableFields, true);
        } else {
          await fsCreateDoc(
            auth.idToken,
            'wpEntities',
            docId,
            {
              ownerId: auth.uid,
              websiteId,
              remoteId: Math.trunc(entity.remoteId),
              entityType: entity.entityType,
              ...mutableFields,
            },
            ['createdAt', 'updatedAt']
          );
        }
        importedCount++;
      }

      const detectedPlugin =
        entities.find((e) => e.seoPlugin !== 'none')?.seoPlugin || conn.seoPlugin || 'none';

      await fsUpdateDoc(auth.idToken, 'wpConnections', websiteId, {
        status: 'connected',
        lastSyncAt: nowIso,
        seoPlugin: detectedPlugin,
        syncMessage: `Imported ${importedCount} catalog item(s)${warnings.length ? ` (${warnings.length} warnings)` : ''}.`.slice(0, 500),
      });

      await fsWriteSyncLog(auth, {
        websiteId,
        channel: 'wordpress',
        action: `Import catalog (${importedCount} items)`,
        status: warnings.length ? 'warning' : 'success',
        detail: warnings.length
          ? `Imported ${importedCount} items. Warnings: ${warnings.join('; ')}`
          : `Successfully imported ${importedCount} products, categories, posts, and pages.`,
      });

      res.json({ importedCount, warnings, seoPlugin: detectedPlugin });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WordPress catalog import failed.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/wordpress/apply', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { optimizationId, recheckLive = true } = req.body as {
        optimizationId?: string;
        recheckLive?: boolean;
      };
      if (!optimizationId) {
        res.status(400).json({ error: 'optimizationId is required.' });
        return;
      }

      const auth = req.firebaseAuth!;
      const opt = await fsGetDoc<{
        websiteId: string;
        entityId?: string;
        remoteId: number;
        entityType: WpEntityType | 'url';
        targetUrl: string;
        targetKeyword?: string;
        status: string;
        optimizedDraft: {
          title?: string;
          seoTitle?: string;
          seoDescription?: string;
          shortDescription?: string;
          description?: string;
        };
      }>(auth.idToken, 'seoOptimizations', optimizationId);

      if (!opt) {
        res.status(404).json({ error: 'Optimization record not found.' });
        return;
      }
      if (opt.status !== 'approved') {
        res.status(400).json({
          error: `Safety gate: Optimization must be explicitly approved by a user before modifying live WordPress data (current status: ${opt.status}).`,
        });
        return;
      }
      if (opt.entityType === 'url' || !opt.remoteId) {
        res.status(400).json({
          error: 'This optimization targets a crawled URL without a linked WordPress/WooCommerce post or product ID. Import the entity via WordPress & WooCommerce first.',
        });
        return;
      }

      const conn = await fsGetDoc<{
        siteUrl: string;
        encryptedSecrets: string;
        seoPlugin: DetectedSeoPlugin;
      }>(auth.idToken, 'wpConnections', opt.websiteId);

      if (!conn || !conn.encryptedSecrets) {
        res.status(404).json({ error: 'No active WordPress/WooCommerce connection found for this website.' });
        return;
      }

      const secrets = decryptSecrets<WpSecrets>(conn.encryptedSecrets);
      const pushRes = await pushChangeToWordPress({
        siteUrl: conn.siteUrl,
        secrets,
        seoPlugin: conn.seoPlugin || 'none',
        entityType: opt.entityType,
        remoteId: opt.remoteId,
        draft: {
          title: opt.optimizedDraft.title,
          description: opt.optimizedDraft.description,
          shortDescription: opt.optimizedDraft.shortDescription,
          seoTitle: opt.optimizedDraft.seoTitle,
          seoDescription: opt.optimizedDraft.seoDescription,
          focusKeyword: opt.targetKeyword,
        },
      });

      const appliedAt = new Date().toISOString().slice(0, 64);
      // Matches firestore.rules transition: approved -> applied (status, appliedAt, updatedAt)
      await fsUpdateDoc(auth.idToken, 'seoOptimizations', optimizationId, {
        status: 'applied',
        appliedAt,
      });

      // Optionally re-crawl live page after applying change
      let verifiedScore: number | undefined;
      if (recheckLive && opt.targetUrl) {
        try {
          const live = await inspectPageRaw(opt.targetUrl, 4);
          verifiedScore = Math.trunc(live.page.score);
          await fsUpdateDoc(auth.idToken, 'seoOptimizations', optimizationId, {
            verifiedScore,
          });
        } catch {
          // ignore non-fatal re-scan failure
        }
      }

      await fsWriteSyncLog(auth, {
        websiteId: opt.websiteId,
        channel: opt.entityType === 'product' || opt.entityType === 'category' ? 'woocommerce' : 'wordpress',
        action: `Apply approved optimization #${opt.remoteId}`,
        status: 'success',
        detail: `${pushRes.detail}${verifiedScore !== undefined ? ` Post-apply live SEO score: ${verifiedScore}/100.` : ''}`,
      });

      res.json({ ok: true, detail: pushRes.detail, appliedAt, verifiedScore });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed applying optimization to WordPress.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/wordpress/rollback', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { optimizationId } = req.body as { optimizationId?: string };
      if (!optimizationId) {
        res.status(400).json({ error: 'optimizationId is required.' });
        return;
      }

      const auth = req.firebaseAuth!;
      const opt = await fsGetDoc<{
        websiteId: string;
        remoteId: number;
        entityType: WpEntityType | 'url';
        status: string;
        originalSnapshot: {
          title?: string;
          seoTitle?: string;
          seoDescription?: string;
          shortDescription?: string;
          description?: string;
          focusKeyword?: string;
        };
      }>(auth.idToken, 'seoOptimizations', optimizationId);

      if (!opt) {
        res.status(404).json({ error: 'Optimization record not found.' });
        return;
      }
      if (opt.status !== 'applied') {
        res.status(400).json({ error: 'Only applied optimizations can be rolled back.' });
        return;
      }
      if (opt.entityType === 'url' || !opt.remoteId) {
        res.status(400).json({ error: 'Cannot roll back URL-only draft without remote WordPress ID.' });
        return;
      }

      const conn = await fsGetDoc<{
        siteUrl: string;
        encryptedSecrets: string;
        seoPlugin: DetectedSeoPlugin;
      }>(auth.idToken, 'wpConnections', opt.websiteId);

      if (!conn || !conn.encryptedSecrets) {
        res.status(404).json({ error: 'WordPress connection not found.' });
        return;
      }

      const secrets = decryptSecrets<WpSecrets>(conn.encryptedSecrets);
      const rollbackRes = await pushChangeToWordPress({
        siteUrl: conn.siteUrl,
        secrets,
        seoPlugin: conn.seoPlugin || 'none',
        entityType: opt.entityType,
        remoteId: opt.remoteId,
        draft: opt.originalSnapshot,
      });

      await fsUpdateDoc(auth.idToken, 'seoOptimizations', optimizationId, {
        status: 'rolled_back',
      });

      await fsWriteSyncLog(auth, {
        websiteId: opt.websiteId,
        channel: 'wordpress',
        action: `Rollback optimization #${opt.remoteId}`,
        status: 'warning',
        detail: `Restored original snapshot: ${rollbackRes.detail}`,
      });

      res.json({ ok: true, detail: rollbackRes.detail });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Rollback failed.';
      res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/wordpress/disconnect', requireFirebaseAuth, async (req, res) => {
    try {
      const websiteId = String(req.query.websiteId || req.body?.websiteId || '').trim();
      if (!websiteId) {
        res.status(400).json({ error: 'websiteId is required.' });
        return;
      }
      const auth = req.firebaseAuth!;
      await fsDeleteDoc(auth.idToken, 'wpConnections', websiteId);
      await fsWriteSyncLog(auth, {
        websiteId,
        channel: 'wordpress',
        action: 'Disconnect store credentials',
        status: 'warning',
        detail: 'Removed encrypted WordPress/WooCommerce credentials from vault.',
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Disconnect failed.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 8. Phase 5: Google Search Console Live OAuth API Integration
  // ---------------------------------------------------------------------------
  app.post('/api/gsc/sites', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const gscToken = String(req.headers['x-google-access-token'] || '').trim();
      if (!gscToken) {
        res.status(401).json({ error: 'Google Search Console OAuth access token is required.' });
        return;
      }
      const gscRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { Authorization: `Bearer ${gscToken}` },
      });
      const data = await gscRes.json();
      if (!gscRes.ok) {
        res.status(gscRes.status).json({
          error: data?.error?.message || `Google Search Console API error (${gscRes.status}).`,
        });
        return;
      }
      res.json({ siteEntry: data.siteEntry || [] });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed fetching GSC sites.' });
    }
  });

  app.post('/api/gsc/performance', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const gscToken = String(req.headers['x-google-access-token'] || '').trim();
      if (!gscToken) {
        res.status(401).json({ error: 'Connect Google Search Console OAuth first.' });
        return;
      }
      const { websiteId, propertyUrl, days = 28 } = req.body as {
        websiteId?: string;
        propertyUrl?: string;
        days?: number;
      };
      if (!websiteId || !propertyUrl) {
        res.status(400).json({ error: 'websiteId and propertyUrl are required.' });
        return;
      }

      const periodDays = Math.max(7, Math.min(90, Number(days) || 28));
      // GSC data typically lags 2 days behind current UTC date
      const endDate = isoDateDaysAgo(2);
      const startDate = isoDateDaysAgo(2 + periodDays - 1);
      const prevEndDate = isoDateDaysAgo(2 + periodDays);
      const prevStartDate = isoDateDaysAgo(2 + periodDays * 2 - 1);

      const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        propertyUrl
      )}/searchAnalytics/query`;

      const queryGsc = async (body: Record<string, unknown>) => {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${gscToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        const json = await r.json();
        if (!r.ok) {
          throw new Error(json?.error?.message || `GSC Search Analytics error (${r.status}).`);
        }
        return (json.rows || []) as Array<{
          keys?: string[];
          clicks?: number;
          impressions?: number;
          ctr?: number;
          position?: number;
        }>;
      };

      const [dailyRows, queryRows, pageRows, countryRows, deviceRows, prevSummaryRows, prevPageRows] = await Promise.all([
        queryGsc({ startDate, endDate, dimensions: ['date'], rowLimit: 90 }),
        queryGsc({ startDate, endDate, dimensions: ['query'], rowLimit: 40 }),
        queryGsc({ startDate, endDate, dimensions: ['page'], rowLimit: 40 }),
        queryGsc({ startDate, endDate, dimensions: ['country'], rowLimit: 25 }),
        queryGsc({ startDate, endDate, dimensions: ['device'], rowLimit: 10 }),
        queryGsc({ startDate: prevStartDate, endDate: prevEndDate, dimensions: ['date'], rowLimit: 90 }),
        queryGsc({ startDate: prevStartDate, endDate: prevEndDate, dimensions: ['page'], rowLimit: 40 }),
      ]);

      const totalClicks = Math.trunc(dailyRows.reduce((s, r) => s + (r.clicks || 0), 0));
      const totalImpressions = Math.trunc(dailyRows.reduce((s, r) => s + (r.impressions || 0), 0));
      const avgCtr =
        totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
      const weightedPosSum = dailyRows.reduce(
        (s, r) => s + (r.position || 0) * Math.max(1, r.impressions || 1),
        0
      );
      const weightDenom = dailyRows.reduce((s, r) => s + Math.max(1, r.impressions || 1), 0);
      const avgPosition =
        dailyRows.length > 0 ? Number((weightedPosSum / Math.max(1, weightDenom)).toFixed(1)) : 0;

      const prevClicks = Math.trunc(prevSummaryRows.reduce((s, r) => s + (r.clicks || 0), 0));
      const prevImpressions = Math.trunc(
        prevSummaryRows.reduce((s, r) => s + (r.impressions || 0), 0)
      );

      const prevPageMap = new Map(
        prevPageRows.map((r) => [r.keys?.[0] || '', { clicks: r.clicks || 0, position: r.position || 0 }])
      );

      const dailySeries = dailyRows.slice(0, 90).map((r) => ({
        date: r.keys?.[0] || '',
        clicks: Math.trunc(r.clicks || 0),
        impressions: Math.trunc(r.impressions || 0),
        ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
        position: Number((r.position || 0).toFixed(1)),
      }));

      const topQueries = queryRows.slice(0, 50).map((r) => ({
        query: r.keys?.[0] || '',
        clicks: Math.trunc(r.clicks || 0),
        impressions: Math.trunc(r.impressions || 0),
        ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
        position: Number((r.position || 0).toFixed(1)),
      }));

      const topPages = pageRows.slice(0, 50).map((r) => {
        const url = r.keys?.[0] || '';
        const prev = prevPageMap.get(url);
        const curPos = Number((r.position || 0).toFixed(1));
        const posDelta = prev ? Number((prev.position - curPos).toFixed(1)) : 0; // positive = improved
        return {
          page: url,
          clicks: Math.trunc(r.clicks || 0),
          impressions: Math.trunc(r.impressions || 0),
          ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
          position: curPos,
          positionDelta: posDelta,
        };
      });

      const topCountries = countryRows.slice(0, 25).map((r) => ({
        country: String(r.keys?.[0] || '').toUpperCase(),
        clicks: Math.trunc(r.clicks || 0),
        impressions: Math.trunc(r.impressions || 0),
        ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
        position: Number((r.position || 0).toFixed(1)),
      }));

      const topDevices = deviceRows.slice(0, 10).map((r) => ({
        device: String(r.keys?.[0] || '').toUpperCase(),
        clicks: Math.trunc(r.clicks || 0),
        impressions: Math.trunc(r.impressions || 0),
        ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
        position: Number((r.position || 0).toFixed(1)),
      }));

      const auth = req.firebaseAuth!;
      const snapshotId = makeDocId('gsc');
      const snapshotPayload = {
        ownerId: auth.uid,
        websiteId,
        propertyUrl: propertyUrl.slice(0, 500),
        dateRangeStart: startDate,
        dateRangeEnd: endDate,
        totalClicks,
        totalImpressions,
        avgCtr,
        avgPosition,
        prevClicks,
        prevImpressions,
        dailySeries,
        topQueries,
        topPages,
        topCountries,
        topDevices,
      };

      await fsCreateDoc(auth.idToken, 'gscSnapshots', snapshotId, snapshotPayload, ['createdAt']);
      await fsWriteSyncLog(auth, {
        websiteId,
        channel: 'gsc',
        action: `Sync Search Console (${periodDays}d)`,
        status: 'success',
        detail: `${propertyUrl}: ${totalClicks} clicks, ${totalImpressions} impressions, avg position ${avgPosition}.`,
      });

      res.json({ id: snapshotId, ...snapshotPayload });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Google Search Console sync failed.',
      });
    }
  });

  app.post('/api/gsc/inspect', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const gscToken = String(req.headers['x-google-access-token'] || '').trim();
      if (!gscToken) {
        res.status(401).json({ error: 'Connect Google Search Console OAuth first.' });
        return;
      }
      const { inspectionUrl, siteUrl } = req.body as {
        inspectionUrl?: string;
        siteUrl?: string;
      };
      if (!inspectionUrl || !siteUrl) {
        res.status(400).json({ error: 'inspectionUrl and siteUrl are required.' });
        return;
      }

      const apiRes = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gscToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inspectionUrl, siteUrl }),
      });
      const json = await apiRes.json();
      if (!apiRes.ok) {
        res.status(apiRes.status).json({
          error: json?.error?.message || `URL Inspection API returned HTTP ${apiRes.status}.`,
        });
        return;
      }

      const idxResult = json?.inspectionResult?.indexStatusResult || {};
      res.json({
        verdict: idxResult.verdict || 'UNKNOWN',
        coverageState: idxResult.coverageState || 'Unknown',
        indexingState: idxResult.indexingState || 'Unknown',
        lastCrawlTime: idxResult.lastCrawlTime || null,
        googleCanonical: idxResult.googleCanonical || null,
        userCanonical: idxResult.userCanonical || null,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'URL inspection failed.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 9. Phase 6: Google Rank Tracker (GSC Verified OR Authorized SERP API Only)
  // ---------------------------------------------------------------------------
  app.post('/api/rank-tracker/check', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { websiteId, keywordIds, gscPropertyUrl } = req.body as {
        websiteId?: string;
        keywordIds?: string[];
        gscPropertyUrl?: string;
      };
      if (!websiteId || !Array.isArray(keywordIds) || keywordIds.length === 0) {
        res.status(400).json({ error: 'websiteId and keywordIds[] are required.' });
        return;
      }

      const gscToken = String(req.headers['x-google-access-token'] || '').trim();
      const serpApiKey = process.env.SERP_API_KEY?.trim() || '';
      const serpProvider = (process.env.SERP_API_PROVIDER || 'serper').toLowerCase();

      if (!gscToken && !serpApiKey) {
        res.status(400).json({
          error: 'No authorized ranking source connected. Connect Google Search Console OAuth (free verified positions) or set SERP_API_KEY on the server. RankPilot never scrapes Google HTML or invents rankings.',
        });
        return;
      }

      const auth = req.firebaseAuth!;
      const site = await fsGetDoc<{ domain: string; url: string }>(
        auth.idToken,
        'websites',
        websiteId
      );
      if (!site) {
        res.status(404).json({ error: 'Website not found.' });
        return;
      }
      const targetDomain = site.domain.replace(/^www\./, '').toLowerCase();

      // If GSC token + property URL is available, query Search Analytics for all queries in last 14 days
      const gscQueryMap = new Map<
        string,
        { position: number; clicks: number; impressions: number; page?: string }
      >();
      if (gscToken && gscPropertyUrl) {
        const endDate = isoDateDaysAgo(2);
        const startDate = isoDateDaysAgo(16);
        const gscRes = await fetch(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
            gscPropertyUrl
          )}/searchAnalytics/query`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${gscToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate,
              endDate,
              dimensions: ['query', 'page'],
              rowLimit: 500,
            }),
          }
        );
        if (gscRes.ok) {
          const json = await gscRes.json();
          for (const row of (json.rows || []) as Array<{
            keys?: string[];
            clicks?: number;
            impressions?: number;
            position?: number;
          }>) {
            const q = (row.keys?.[0] || '').toLowerCase().trim();
            const page = row.keys?.[1] || '';
            if (!q) continue;
            const prev = gscQueryMap.get(q);
            if (!prev || (row.impressions || 0) > prev.impressions) {
              gscQueryMap.set(q, {
                position: Number((row.position || 0).toFixed(1)),
                clicks: Math.trunc(row.clicks || 0),
                impressions: Math.trunc(row.impressions || 0),
                page,
              });
            }
          }
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const updatedResults: Array<{
        id: string;
        keyword: string;
        currentPosition: number;
        sourceType: string;
      }> = [];

      for (const kwId of keywordIds.slice(0, 20)) {
        const kwDoc = await fsGetDoc<{
          keyword: string;
          targetUrl?: string;
          country: string;
          language: string;
          device: 'desktop' | 'mobile';
          currentPosition: number;
          bestPosition: number;
          history: Array<{ date: string; position: number; source: string }>;
        }>(auth.idToken, 'trackedKeywords', kwId);
        if (!kwDoc) continue;

        let newPos = kwDoc.currentPosition || 0;
        let clicks = 0;
        let impressions = 0;
        let sourceType: 'gsc_verified' | 'serp_api' | 'unverified' = 'unverified';
        let matchedUrl = kwDoc.targetUrl || '';

        const gscHit = gscQueryMap.get(kwDoc.keyword.toLowerCase().trim());
        if (gscHit && gscHit.position > 0) {
          newPos = gscHit.position;
          clicks = gscHit.clicks;
          impressions = gscHit.impressions;
          sourceType = 'gsc_verified';
          if (gscHit.page && !matchedUrl) matchedUrl = gscHit.page;
        } else if (serpApiKey) {
          const glCode =
            COUNTRY_TARGETS[kwDoc.country.toUpperCase()]?.gl ||
            kwDoc.country.toLowerCase().slice(0, 2);
          if (serpProvider === 'serper') {
            const sRes = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: {
                'X-API-KEY': serpApiKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                q: kwDoc.keyword,
                gl: glCode,
                hl: kwDoc.language.toLowerCase().slice(0, 2),
                num: 50,
              }),
            });
            if (sRes.ok) {
              const sJson = (await sRes.json()) as {
                organic?: Array<{ link?: string; position?: number }>;
              };
              const match = (sJson.organic || []).find((r) =>
                String(r.link || '').toLowerCase().includes(targetDomain)
              );
              newPos = match?.position ? Number(match.position) : 0;
              sourceType = 'serp_api';
              if (match?.link && !matchedUrl) matchedUrl = match.link;
            }
          } else if (serpProvider === 'serpapi') {
            const url = new URL('https://serpapi.com/search.json');
            url.searchParams.set('q', kwDoc.keyword);
            url.searchParams.set('gl', glCode);
            url.searchParams.set('hl', kwDoc.language.toLowerCase().slice(0, 2));
            url.searchParams.set('device', kwDoc.device);
            url.searchParams.set('num', '50');
            url.searchParams.set('api_key', serpApiKey);
            const sRes = await fetch(url.toString());
            if (sRes.ok) {
              const sJson = (await sRes.json()) as {
                organic_results?: Array<{ link?: string; position?: number }>;
              };
              const match = (sJson.organic_results || []).find((r) =>
                String(r.link || '').toLowerCase().includes(targetDomain)
              );
              newPos = match?.position ? Number(match.position) : 0;
              sourceType = 'serp_api';
              if (match?.link && !matchedUrl) matchedUrl = match.link;
            }
          }
        }

        const prevPos = kwDoc.currentPosition || 0;
        const bestPos =
          newPos > 0
            ? kwDoc.bestPosition > 0
              ? Math.min(kwDoc.bestPosition, newPos)
              : newPos
            : kwDoc.bestPosition || 0;

        const nextHistory = [
          ...(Array.isArray(kwDoc.history) ? kwDoc.history.filter((h) => h.date !== today) : []),
          { date: today, position: newPos, source: sourceType },
        ].slice(-55);

        await fsUpdateDoc(auth.idToken, 'trackedKeywords', kwId, {
          targetUrl: matchedUrl.slice(0, 500),
          previousPosition: prevPos,
          currentPosition: newPos,
          bestPosition: bestPos,
          sourceType,
          clicks: Math.trunc(clicks),
          impressions: Math.trunc(impressions),
          history: nextHistory,
          lastCheckedAt: new Date().toISOString().slice(0, 64),
        });

        updatedResults.push({
          id: kwId,
          keyword: kwDoc.keyword,
          currentPosition: newPos,
          sourceType,
        });
      }

      await fsWriteSyncLog(auth, {
        websiteId,
        channel: 'rank_tracker',
        action: `Synced ${updatedResults.length} tracked keyword(s)`,
        status: 'success',
        detail: `Checked positions via ${gscToken ? 'Google Search Console' : 'Authorized SERP API'}.`,
      });

      res.json({ updated: updatedResults });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Rank sync failed.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 10. Phase 7: Google PageSpeed Insights v5 + Technical Monitor
  // ---------------------------------------------------------------------------
  app.post('/api/pagespeed/analyze', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { websiteId, url, strategy = 'mobile' } = req.body as {
        websiteId?: string;
        url?: string;
        strategy?: 'mobile' | 'desktop';
      };
      if (!websiteId || !url) {
        res.status(400).json({ error: 'websiteId and url are required.' });
        return;
      }

      const parsedUrl = await validatePublicHttpUrl(url);
      const normalizedUrl = normalizePsiUrl(parsedUrl);
      const cleanStrategy = strategy === 'desktop' ? 'desktop' : 'mobile';
      const auth = req.firebaseAuth!;
      const keyCfg = getPageSpeedKeyConfig();

      // 1. Check persisted Firestore technicalSnapshots for a <24h match on the same URL + device
      try {
        const existingDocs = await fsQueryByOwner<{
          websiteId?: string;
          url?: string;
          strategy?: string;
          createdAt?: string;
          performanceScore?: number;
          seoScore?: number;
          accessibilityScore?: number;
          bestPracticesScore?: number;
          lcpMs?: number;
          cls?: number;
          inpMs?: number;
          fcpMs?: number;
          ttfbMs?: number;
          robotsStatus?: string;
          sitemapStatus?: string;
          opportunities?: Array<{ title: string; savings: string; description: string }>;
        }>(auth.idToken, 'technicalSnapshots', auth.uid, 100);

        const nowMs = Date.now();
        const recentMatch = existingDocs
          .filter((doc) => {
            if (doc.websiteId !== websiteId || doc.strategy !== cleanStrategy || !doc.url) {
              return false;
            }
            try {
              const docNormalized = normalizePsiUrl(new URL(doc.url));
              if (docNormalized !== normalizedUrl) return false;
            } catch {
              return false;
            }
            const createdMs = doc.createdAt ? Date.parse(doc.createdAt) : 0;
            return createdMs > 0 && nowMs - createdMs < PSI_CACHE_TTL_MS;
          })
          .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))[0];

        if (recentMatch) {
          const createdMs = Date.parse(recentMatch.createdAt || '');
          res.json({
            ...recentMatch,
            cached: true,
            cachedAt: recentMatch.createdAt,
            cacheExpiresAt: new Date(createdMs + PSI_CACHE_TTL_MS).toISOString(),
            keySource: keyCfg.source,
          });
          return;
        }
      } catch (cacheLookupErr) {
        console.warn(
          'Non-fatal Firestore 24h PageSpeed cache check error:',
          cacheLookupErr instanceof Error ? cacheLookupErr.message : cacheLookupErr
        );
      }

      // 2. Fetch via in-memory 24h cache + in-flight deduplication + quota circuit breaker
      const psiResult = await fetchPageSpeedWithCache(parsedUrl, cleanStrategy);
      const { metrics, cached, cachedAt, cacheExpiresAt } = psiResult;

      const techId = makeDocId('tech');
      const snapshotPayload = {
        ownerId: auth.uid,
        websiteId,
        ...metrics,
      };

      await fsCreateDoc(auth.idToken, 'technicalSnapshots', techId, snapshotPayload, ['createdAt']);
      if (!cached) {
        await fsWriteSyncLog(auth, {
          websiteId,
          channel: 'pagespeed',
          action: `PageSpeed ${cleanStrategy} audit`,
          status: metrics.performanceScore >= 75 ? 'success' : 'warning',
          detail: `${parsedUrl.hostname} (${cleanStrategy}): Perf ${metrics.performanceScore}, SEO ${metrics.seoScore}, LCP ${(metrics.lcpMs / 1000).toFixed(2)}s, CLS ${metrics.cls}.`,
        });
      }

      res.json({
        id: techId,
        ...snapshotPayload,
        cached,
        cachedAt,
        cacheExpiresAt,
        keySource: psiResult.keySource,
      });
    } catch (err) {
      if (err instanceof PageSpeedApiError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          quotaExceeded: err.quotaExceeded,
          consumerProject: err.consumerProject,
          keySource: err.keySource,
          retryAfter: err.retryAfter,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'PageSpeed analysis failed.';
      res.status(500).json({ error: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // 13. Google Analytics 4 Live OAuth Integration (/api/ga4/*)
  // ---------------------------------------------------------------------------
  app.post('/api/ga4/properties', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const gaToken = String(req.headers['x-google-access-token'] || '').trim();
      if (!gaToken) {
        res.status(401).json({ error: 'Google Analytics 4 OAuth access token is required.' });
        return;
      }
      const gaRes = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
        headers: { Authorization: `Bearer ${gaToken}` },
      });
      const data = await gaRes.json();
      if (!gaRes.ok) {
        res.status(gaRes.status).json({
          error: data?.error?.message || `Google Analytics Admin API error (${gaRes.status}).`,
        });
        return;
      }
      const properties: Array<{ propertyId: string; displayName: string; accountName: string }> = [];
      for (const acct of (data.accountSummaries || []) as Array<{
        displayName?: string;
        propertySummaries?: Array<{ property?: string; displayName?: string }>;
      }>) {
        for (const prop of acct.propertySummaries || []) {
          if (prop.property) {
            properties.push({
              propertyId: prop.property,
              displayName: prop.displayName || prop.property,
              accountName: acct.displayName || 'GA4 Account',
            });
          }
        }
      }
      res.json({ properties });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed loading GA4 properties.' });
    }
  });

  app.post('/api/ga4/report', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const gaToken = String(req.headers['x-google-access-token'] || '').trim();
      if (!gaToken) {
        res.status(401).json({ error: 'Connect Google Analytics 4 OAuth first.' });
        return;
      }
      const { websiteId, propertyId, days = 28 } = req.body as {
        websiteId?: string;
        propertyId?: string;
        days?: number;
      };
      if (!websiteId || !propertyId) {
        res.status(400).json({ error: 'websiteId and propertyId are required.' });
        return;
      }

      const normalizedProp = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;
      const periodDays = Math.max(7, Math.min(90, Number(days) || 28));
      const endDate = isoDateDaysAgo(0);
      const startDate = isoDateDaysAgo(periodDays - 1);

      const runGaReport = async (body: Record<string, unknown>) => {
        const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${normalizedProp}:runReport`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${gaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        const json = await r.json();
        if (!r.ok) {
          throw new Error(json?.error?.message || `GA4 Data API returned HTTP ${r.status}.`);
        }
        return (json.rows || []) as Array<{
          dimensionValues?: Array<{ value?: string }>;
          metricValues?: Array<{ value?: string }>;
        }>;
      };

      const dateRanges = [{ startDate, endDate }];
      const [summaryRows, sourceRows, landingRows, campaignRows, dailyRows] = await Promise.all([
        runGaReport({
          dateRanges,
          metrics: [
            { name: 'totalUsers' },
            { name: 'newUsers' },
            { name: 'sessions' },
            { name: 'conversions' },
            { name: 'purchaseRevenue' },
          ],
        }),
        runGaReport({
          dateRanges,
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }],
          limit: 20,
        }),
        runGaReport({
          dateRanges,
          dimensions: [{ name: 'landingPagePlusQueryString' }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }, { name: 'purchaseRevenue' }],
          limit: 25,
        }),
        runGaReport({
          dateRanges,
          dimensions: [{ name: 'sessionCampaignName' }, { name: 'sessionSourceMedium' }],
          metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'purchaseRevenue' }],
          limit: 25,
        }),
        runGaReport({
          dateRanges,
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'purchaseRevenue' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
          limit: 90,
        }),
      ]);

      const numVal = (row: { metricValues?: Array<{ value?: string }> } | undefined, idx: number) =>
        Number(row?.metricValues?.[idx]?.value || 0);

      const s0 = summaryRows[0];
      const totalUsers = Math.trunc(numVal(s0, 0));
      const newUsers = Math.trunc(numVal(s0, 1));
      const returningUsers = Math.max(0, totalUsers - newUsers);
      const sessions = Math.trunc(numVal(s0, 2));
      const conversions = Math.trunc(numVal(s0, 3));
      const purchaseRevenue = Number(numVal(s0, 4).toFixed(2));
      const conversionRate = sessions > 0 ? Number(((conversions / sessions) * 100).toFixed(2)) : 0;

      const trafficSources = sourceRows.slice(0, 30).map((r) => ({
        channel: String(r.dimensionValues?.[0]?.value || 'Unassigned').slice(0, 80),
        sessions: Math.trunc(numVal(r, 0)),
        users: Math.trunc(numVal(r, 1)),
        conversions: Math.trunc(numVal(r, 2)),
      }));

      const sumChannel = (kw: string) =>
        trafficSources
          .filter((s) => s.channel.toLowerCase().includes(kw))
          .reduce((acc, s) => acc + s.sessions, 0);

      const organicSessions = sumChannel('organic');
      const directSessions = sumChannel('direct');
      const referralSessions = sumChannel('referral');
      const campaignSessions = campaignRows
        .filter((r) => {
          const c = (r.dimensionValues?.[0]?.value || '').toLowerCase();
          return c && c !== '(not set)' && c !== '(direct)' && c !== '(organic)';
        })
        .reduce((acc, r) => acc + Math.trunc(numVal(r, 0)), 0);

      const topLandingPages = landingRows.slice(0, 40).map((r) => ({
        page: String(r.dimensionValues?.[0]?.value || '/').slice(0, 300),
        sessions: Math.trunc(numVal(r, 0)),
        users: Math.trunc(numVal(r, 1)),
        conversions: Math.trunc(numVal(r, 2)),
        revenue: Number(numVal(r, 3).toFixed(2)),
      }));

      const campaignPerformance = campaignRows.slice(0, 40).map((r) => ({
        campaign: String(r.dimensionValues?.[0]?.value || '(not set)').slice(0, 120),
        sourceMedium: String(r.dimensionValues?.[1]?.value || '(direct) / (none)').slice(0, 120),
        sessions: Math.trunc(numVal(r, 0)),
        conversions: Math.trunc(numVal(r, 1)),
        revenue: Number(numVal(r, 2).toFixed(2)),
      }));

      const dailySeries = dailyRows.slice(0, 90).map((r) => {
        const rawDate = String(r.dimensionValues?.[0]?.value || '');
        const isoDate =
          rawDate.length === 8
            ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
            : rawDate;
        return {
          date: isoDate,
          sessions: Math.trunc(numVal(r, 0)),
          conversions: Math.trunc(numVal(r, 1)),
          revenue: Number(numVal(r, 2).toFixed(2)),
        };
      });

      const auth = req.firebaseAuth!;
      const snapId = makeDocId('ga4');
      const snapPayload = {
        ownerId: auth.uid,
        websiteId,
        propertyId: normalizedProp.slice(0, 128),
        dateRangeStart: startDate,
        dateRangeEnd: endDate,
        totalUsers,
        newUsers,
        returningUsers,
        sessions,
        organicSessions,
        directSessions,
        referralSessions,
        campaignSessions,
        conversions,
        conversionRate,
        purchaseRevenue,
        hasVerifiedRevenue: purchaseRevenue > 0,
        trafficSources,
        topLandingPages,
        campaignPerformance,
        dailySeries,
      };

      await fsCreateDoc(auth.idToken, 'analyticsSnapshots', snapId, snapPayload, ['createdAt']);
      await fsWriteSyncLog(auth, {
        websiteId,
        channel: 'ga4',
        action: `Sync GA4 report (${periodDays}d)`,
        status: 'success',
        detail: `${normalizedProp}: ${sessions} sessions, ${totalUsers} users, ${conversions} conversions.`,
      });

      res.json({ id: snapId, ...snapPayload });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Google Analytics 4 sync failed.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 14. AI SEO Recommendations Generator (/api/ai/recommendations)
  // ---------------------------------------------------------------------------
  app.post('/api/ai/recommendations', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { websiteId, domain, contextSummary } = req.body as {
        websiteId?: string;
        domain?: string;
        contextSummary?: string;
      };
      if (!websiteId || !domain) {
        res.status(400).json({ error: 'websiteId and domain are required.' });
        return;
      }

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Analyze all available SEO telemetry for website ${String(domain).slice(0, 200)} and synthesize 6 to 8 prioritized, high-leverage SEO action items.

REAL WORKSPACE TELEMETRY:
${String(contextSummary || 'No prior audit data supplied; analyze core site fundamentals.').slice(0, 12000)}

Rules:
- Each recommendation must belong to category: "technical" | "on_page" | "keyword" | "content" | "internal_linking"
- Priority must be strictly: "Critical" | "High" | "Medium" | "Low"
- Clearly ground sourceBasis in the metrics actually supplied above (e.g. "Site Crawl Audit", "GSC Performance", "PageSpeed CWV", "GA4 Performance", "Keyword Research").
- Provide crystal-clear, actionable steps specifying exact affected URLs/paths where known.`,
          config: {
            systemInstruction:
              'You are a Principal SEO Growth Architect. Convert verified crawl, Search Console, GA4, and PageSpeed signals into concrete engineering and content action items without hallucinating unseen numbers.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                recommendations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      category: { type: Type.STRING },
                      priority: { type: Type.STRING },
                      affectedPage: { type: Type.STRING },
                      whatIsWrong: { type: Type.STRING },
                      whyItMatters: { type: Type.STRING },
                      howToFix: { type: Type.STRING },
                      expectedBenefit: { type: Type.STRING },
                      sourceBasis: { type: Type.STRING },
                    },
                    required: [
                      'category',
                      'priority',
                      'affectedPage',
                      'whatIsWrong',
                      'whyItMatters',
                      'howToFix',
                      'expectedBenefit',
                      'sourceBasis',
                    ],
                  },
                },
              },
              required: ['recommendations'],
            },
          },
        })
      );

      const parsed = JSON.parse(response.text || '{}');
      const allowedCats = new Set(['technical', 'on_page', 'keyword', 'content', 'internal_linking']);
      const allowedPri = new Set(['Critical', 'High', 'Medium', 'Low']);

      const rawList = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 10) : [];
      const auth = req.firebaseAuth!;
      const createdIds: string[] = [];

      for (const item of rawList) {
        const recId = makeDocId('rec');
        const category = allowedCats.has(String(item.category)) ? String(item.category) : 'on_page';
        const priority = allowedPri.has(String(item.priority)) ? String(item.priority) : 'High';
        await fsCreateDoc(
          auth.idToken,
          'seoRecommendations',
          recId,
          {
            ownerId: auth.uid,
            websiteId,
            category,
            priority,
            status: 'open',
            affectedPage: String(item.affectedPage || domain).slice(0, 480) || domain,
            whatIsWrong: String(item.whatIsWrong || 'SEO optimization opportunity identified').slice(0, 950),
            whyItMatters: String(item.whyItMatters || 'Improves organic search visibility and relevance.').slice(0, 950),
            howToFix: String(item.howToFix || 'Review affected page and apply updated metadata or structure.').slice(0, 1900),
            expectedBenefit: String(item.expectedBenefit || 'Higher organic click-through and crawl efficiency.').slice(0, 950),
            sourceBasis: String(item.sourceBasis || 'Workspace Telemetry').slice(0, 480),
          },
          ['createdAt', 'updatedAt']
        );
        createdIds.push(recId);
      }

      await fsWriteSyncLog(auth, {
        websiteId,
        channel: 'recommendations',
        action: `Generated ${createdIds.length} AI SEO action(s)`,
        status: 'success',
        detail: `Synthesized prioritized recommendations for ${domain} across technical, on-page, and keyword signals.`,
      });

      res.json({ createdCount: createdIds.length, createdIds });
    } catch (err) {
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  return app;
}
