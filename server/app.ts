import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import {
  fsCreateDoc,
  fsDeleteDoc,
  fsGetDoc,
  fsUpdateDoc,
  fsWriteSyncLog,
  getFirebaseConfig,
  requireFirebaseAuth,
} from './firebaseAuth';
import { decryptSecrets, encryptSecrets, hasDedicatedEncryptionKey } from './cryptoVault';
import {
  crawlEntireSite,
  inspectPageRaw,
  inspectRobotsAndSitemap,
  validatePublicHttpUrl,
} from './crawler';
import {
  DetectedSeoPlugin,
  WpEntityType,
  WpSecrets,
  importWordPressCatalog,
  pushChangeToWordPress,
  verifyWordPressConnection,
} from './wordpress';

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
  app.use(express.text({ type: 'text/plain', limit: '64kb' }));

  const aiLimiter = createRateLimiter(25, 60_000);
  const trackLimiter = createRateLimiter(120, 60_000);

  // ---------------------------------------------------------------------------
  // 0. Health Endpoint (public, zero secrets)
  // ---------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'RankPilot AI',
      timestamp: new Date().toISOString(),
      capabilities: {
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        dedicatedVaultKey: hasDedicatedEncryptionKey(),
        pageSpeedKeyConfigured: Boolean(process.env.GOOGLE_PAGESPEED_API_KEY),
        serpApiConfigured: Boolean(process.env.SERP_API_KEY),
      },
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
        issues.push({ severity: 'critical', category: 'Indexing', title: 'Meta robots noindex present', detail: 'Search engines are instructed not to index this URL.' });
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
  // 3. Gemini AI Seed Keyword Research (Protected)
  // ---------------------------------------------------------------------------
  app.post('/api/ai/keywords', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { seedKeyword, targetMarket = 'Global / English', websiteUrl = '' } = req.body as {
        seedKeyword?: string;
        targetMarket?: string;
        websiteUrl?: string;
      };

      if (!seedKeyword || typeof seedKeyword !== 'string' || seedKeyword.trim().length < 2 || seedKeyword.trim().length > 160) {
        res.status(400).json({ error: 'Please provide a seed keyword between 2 and 160 characters.' });
        return;
      }

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Generate an AI keyword strategy for seed keyword: "${seedKeyword.trim()}".
Target market: ${String(targetMarket).slice(0, 80)}.
${websiteUrl ? `Target website context: ${String(websiteUrl).slice(0, 300)}.` : ''}

Important: Do NOT invent fake exact monthly search volumes or exact keyword difficulty numbers. Instead classify search intent, estimated competition tier (Low/Medium/High — labeled as AI Estimate), topic clusters, and high-converting content ideas.`,
          config: {
            systemInstruction: 'You are an expert SEO strategist. Return structured keyword intelligence without fabricating search volume numbers.',
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
                      rationale: { type: Type.STRING },
                    },
                    required: ['keyword', 'intent', 'competitionEstimate', 'rationale'],
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
                    },
                    required: ['keyword', 'intent', 'funnelStage'],
                  },
                },
                clusters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      clusterName: { type: Type.STRING },
                      pillarTopic: { type: Type.STRING },
                      keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['clusterName', 'pillarTopic', 'keywords'],
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
              required: ['relatedKeywords', 'longTailKeywords', 'clusters', 'contentIdeas', 'suggestedTitles'],
            },
          },
        })
      );

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        seedKeyword: seedKeyword.trim(),
        targetMarket: String(targetMarket).slice(0, 80),
        relatedKeywords: (parsed.relatedKeywords || []).slice(0, 20),
        longTailKeywords: (parsed.longTailKeywords || []).slice(0, 20),
        clusters: (parsed.clusters || []).slice(0, 10),
        contentIdeas: (parsed.contentIdeas || []).slice(0, 10),
        suggestedTitles: (parsed.suggestedTitles || []).slice(0, 12),
      });
    } catch (err) {
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Phase 2: Page/Product Keyword Mapping + Cannibalization Analysis
  // ---------------------------------------------------------------------------
  app.post('/api/ai/keyword-map', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const { websiteDomain, targetMarket = 'United States / English', pages } = req.body as {
        websiteDomain?: string;
        targetMarket?: string;
        pages?: Array<{ url: string; title: string; pageType: string; existingKeyword?: string }>;
      };

      if (!Array.isArray(pages) || pages.length === 0) {
        res.status(400).json({ error: 'Provide at least 1 crawled page or WordPress entity to map keywords.' });
        return;
      }

      const slice = pages.slice(0, 20);
      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Analyze this inventory of pages/products on ${String(websiteDomain || 'the website').slice(0, 200)} (Market: ${targetMarket}).
For each page:
1. Recommend 1 primary target keyword and 2-3 long-tail supporting keywords.
2. Classify search intent (Transactional, Commercial, Informational, Navigational).
3. Estimate AI competition tier (Low / Medium / High — AI estimate only, DO NOT invent monthly search volume or exact rank numbers).
4. Detect potential keyword cannibalization where multiple URLs compete for the same primary topic/intent, and advise how to differentiate canonical targets.

Pages:
${slice
  .map(
    (p, i) =>
      `${i + 1}. [${p.pageType}] URL: ${p.url} | Title: "${p.title}" | Current Focus Keyword: "${p.existingKeyword || 'none'}"`
  )
  .join('\n')}`,
          config: {
            systemInstruction: 'You are an enterprise e-commerce & SaaS SEO architect. Map distinct keywords per URL and detect cannibalization without inventing search volume or ranking figures.',
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
        dataNotice: 'Intent & competition tiers are AI-estimated. Connect Google Search Console for verified impressions and rankings.',
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
  // 6. Gemini AI Content Studio (Protected)
  // ---------------------------------------------------------------------------
  app.post('/api/ai/content', requireFirebaseAuth, aiLimiter, async (req, res) => {
    try {
      const {
        contentType,
        topic,
        targetKeyword = '',
        tone = 'Authoritative & Clear',
        audience = 'B2B Decision Makers',
        websiteName = '',
      } = req.body as {
        contentType?: string;
        topic?: string;
        targetKeyword?: string;
        tone?: string;
        audience?: string;
        websiteName?: string;
      };

      if (!topic || typeof topic !== 'string' || topic.trim().length < 2 || topic.trim().length > 2000) {
        res.status(400).json({ error: 'Please provide a topic or product description prompt (2–2000 chars).' });
        return;
      }

      const ai = getGeminiClient();
      const formatMap: Record<string, string> = {
        blog: 'a comprehensive, well-structured SEO blog article in Markdown with H2/H3 subheadings, actionable sections, and a concise conclusion',
        meta_title: '5 optimized SEO meta title variations (each 50-60 characters) with rationale',
        meta_description: '5 high-CTR SEO meta description variations (each 135-155 characters) with rationale',
        product_description: 'a persuasive, benefit-focused product/service description with scannable bullet features and conversion CTA',
        landing_page: 'conversion-oriented landing page copy including Hero Headline, Subheadline, Value Pillars, Social Proof Prompts, and CTA section',
        faq: '6 structured SEO-ready Frequently Asked Questions with crisp, direct answers suitable for FAQ schema',
      };

      if (contentType && !formatMap[contentType]) {
        res.status(400).json({ error: `Unsupported contentType. Allowed values: ${Object.keys(formatMap).join(', ')}.` });
        return;
      }

      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Write ${formatMap[contentType || 'blog']}.
Topic / Product: ${topic.trim()}
Target Primary Keyword: ${String(targetKeyword || topic).trim().slice(0, 160)}
Tone: ${String(tone).slice(0, 80)}
Target Audience: ${String(audience).slice(0, 120)}
${websiteName ? `Brand / Website: ${String(websiteName).slice(0, 120)}` : ''}

Return a clean title, SEO metaTitle (under 60 chars), SEO metaDescription (under 155 chars), and the full body text.`,
          config: {
            systemInstruction: 'You are an expert B2B SEO copywriter. Produce original, high-converting, human-sounding copy without fluff.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                metaTitle: { type: Type.STRING },
                metaDescription: { type: Type.STRING },
                body: { type: Type.STRING },
              },
              required: ['title', 'metaTitle', 'metaDescription', 'body'],
            },
          },
        })
      );

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        title: String(parsed.title || topic).slice(0, 240),
        metaTitle: String(parsed.metaTitle || '').slice(0, 160),
        metaDescription: String(parsed.metaDescription || '').slice(0, 320),
        body: String(parsed.body || '').slice(0, 24000),
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

      const [dailyRows, queryRows, pageRows, prevSummaryRows, prevPageRows] = await Promise.all([
        queryGsc({ startDate, endDate, dimensions: ['date'], rowLimit: 90 }),
        queryGsc({ startDate, endDate, dimensions: ['query'], rowLimit: 40 }),
        queryGsc({ startDate, endDate, dimensions: ['page'], rowLimit: 40 }),
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
          if (serpProvider === 'serper') {
            const sRes = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: {
                'X-API-KEY': serpApiKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                q: kwDoc.keyword,
                gl: kwDoc.country.toLowerCase().slice(0, 2),
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
            url.searchParams.set('gl', kwDoc.country.toLowerCase().slice(0, 2));
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
      const cleanStrategy = strategy === 'desktop' ? 'desktop' : 'mobile';

      const psiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
      psiUrl.searchParams.set('url', parsedUrl.toString());
      psiUrl.searchParams.set('strategy', cleanStrategy);
      ['performance', 'seo', 'accessibility', 'best-practices'].forEach((cat) =>
        psiUrl.searchParams.append('category', cat)
      );
      if (process.env.GOOGLE_PAGESPEED_API_KEY?.trim()) {
        psiUrl.searchParams.set('key', process.env.GOOGLE_PAGESPEED_API_KEY.trim());
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      let psiRes: Response;
      try {
        psiRes = await fetch(psiUrl.toString(), { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }

      const psiJson = await psiRes.json();
      if (!psiRes.ok) {
        res.status(psiRes.status).json({
          error:
            psiJson?.error?.message ||
            `PageSpeed Insights API returned HTTP ${psiRes.status}. Configure GOOGLE_PAGESPEED_API_KEY on the server if public rate limit is reached.`,
        });
        return;
      }

      const lh = psiJson?.lighthouseResult || {};
      const cats = lh.categories || {};
      const audits = lh.audits || {};

      const scoreOf = (catKey: string) =>
        Math.trunc(Math.round(((cats[catKey]?.score as number) || 0) * 100));
      const numAudit = (key: string) => Number(audits[key]?.numericValue || 0);

      const performanceScore = scoreOf('performance');
      const seoScore = scoreOf('seo');
      const accessibilityScore = scoreOf('accessibility');
      const bestPracticesScore = scoreOf('best-practices');

      const lcpMs = Math.round(numAudit('largest-contentful-paint'));
      const cls = Number(numAudit('cumulative-layout-shift').toFixed(3));
      const inpMs = Math.round(
        numAudit('interaction-to-next-paint') || numAudit('max-potential-fid') || 0
      );
      const fcpMs = Math.round(numAudit('first-contentful-paint'));
      const ttfbMs = Math.round(numAudit('server-response-time'));

      const opportunities = Object.values(audits)
        .filter((a: unknown) => {
          const aud = a as { score?: number | null; details?: { type?: string }; title?: string };
          return (
            aud &&
            aud.score !== null &&
            aud.score !== undefined &&
            aud.score < 0.9 &&
            aud.details?.type === 'opportunity' &&
            aud.title
          );
        })
        .slice(0, 12)
        .map((a: unknown) => {
          const aud = a as {
            id?: string;
            title?: string;
            displayValue?: string;
            description?: string;
          };
          return {
            title: String(aud.title || '').slice(0, 140),
            savings: String(aud.displayValue || 'Optimization available').slice(0, 80),
            description: String(aud.description || '').replace(/\[.*?\]\(.*?\)/g, '').slice(0, 260),
          };
        });

      const robotsMeta = await inspectRobotsAndSitemap(parsedUrl);
      const robotsStatus = robotsMeta.robotsBlockingAll
        ? 'Blocked (Disallow: /)'
        : robotsMeta.robotsTxtFound
        ? 'Allowed'
        : 'Missing robots.txt';
      const sitemapStatus = robotsMeta.sitemapFound
        ? `Active (${robotsMeta.sitemapUrls.length} sampled URLs)`
        : 'Missing sitemap.xml';

      const auth = req.firebaseAuth!;
      const techId = makeDocId('tech');
      const snapshotPayload = {
        ownerId: auth.uid,
        websiteId,
        url: parsedUrl.toString().slice(0, 500),
        strategy: cleanStrategy,
        performanceScore,
        seoScore,
        accessibilityScore,
        bestPracticesScore,
        lcpMs,
        cls,
        inpMs,
        fcpMs,
        ttfbMs,
        robotsStatus: robotsStatus.slice(0, 120),
        sitemapStatus: sitemapStatus.slice(0, 120),
        opportunities,
      };

      await fsCreateDoc(auth.idToken, 'technicalSnapshots', techId, snapshotPayload, ['createdAt']);
      await fsWriteSyncLog(auth, {
        websiteId,
        channel: 'pagespeed',
        action: `PageSpeed ${cleanStrategy} audit`,
        status: performanceScore >= 75 ? 'success' : 'warning',
        detail: `${parsedUrl.hostname} (${cleanStrategy}): Perf ${performanceScore}, SEO ${seoScore}, LCP ${(lcpMs / 1000).toFixed(2)}s, CLS ${cls}.`,
      });

      res.json({ id: techId, ...snapshotPayload });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PageSpeed analysis failed.';
      res.status(500).json({ error: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // 11. Lightweight Website Visitor Tracking Script (/track.js) — PUBLIC
  // ---------------------------------------------------------------------------
  app.get('/track.js', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const endpoint = `${protocol}://${host}/api/track`;

    const script = `(function(w, d) {
  if (w.rankpilot && w.rankpilot._initialized) return;
  var scriptEl = d.currentScript || d.querySelector('script[data-tracking-id]');
  var trackingId = (scriptEl && scriptEl.getAttribute('data-tracking-id')) || w.RANKPILOT_TRACKING_ID || '';
  if (!trackingId) return;

  var SESSION_TTL_MS = 30 * 60 * 1000;

  function genId(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function getVisitorId() {
    try {
      var vid = w.localStorage.getItem('rp_vid');
      if (!vid) { vid = genId('v'); w.localStorage.setItem('rp_vid', vid); }
      return vid;
    } catch (e) {
      var match = d.cookie.match(/(?:^|; )rp_vid=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
      var fallback = genId('v');
      d.cookie = 'rp_vid=' + encodeURIComponent(fallback) + '; path=/; max-age=31536000; SameSite=Lax';
      return fallback;
    }
  }

  function getSessionId() {
    try {
      var now = Date.now();
      var raw = w.sessionStorage.getItem('rp_session');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.id && (now - parsed.ts) < SESSION_TTL_MS) {
          w.sessionStorage.setItem('rp_session', JSON.stringify({ id: parsed.id, ts: now }));
          return parsed.id;
        }
      }
      var sid = genId('s');
      w.sessionStorage.setItem('rp_session', JSON.stringify({ id: sid, ts: now }));
      return sid;
    } catch (e) { return genId('s'); }
  }

  function getDeviceType() {
    var ua = navigator.userAgent || '';
    if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
    if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function inferSource(utmSource, ref) {
    if (utmSource) return utmSource;
    if (!ref) return 'Direct';
    try {
      var h = new URL(ref).hostname.toLowerCase();
      if (h === w.location.hostname.toLowerCase()) return 'Direct';
      if (/google\\.|bing\\.|duckduckgo\\.|yahoo\\.|ecosia\\./.test(h)) return 'Organic Search';
      if (/facebook\\.|instagram\\.|linkedin\\.|twitter\\.|x\\.com|tiktok\\./.test(h)) return 'Social';
      return 'Referral';
    } catch (e) { return 'Direct'; }
  }

  function send(eventType, value, customPath) {
    var params = new URLSearchParams(w.location.search || '');
    var utmSource = params.get('utm_source') || '';
    var utmMedium = params.get('utm_medium') || '';
    var utmCampaign = params.get('utm_campaign') || '';
    var ref = d.referrer || '';
    var payload = JSON.stringify({
      trackingId: trackingId,
      visitorId: getVisitorId(),
      sessionId: getSessionId(),
      eventType: eventType || 'pageview',
      path: customPath || (w.location.pathname + w.location.search) || '/',
      referrer: ref.slice(0, 500),
      trafficSource: inferSource(utmSource, ref),
      utmSource: utmSource.slice(0, 120),
      utmMedium: utmMedium.slice(0, 120),
      utmCampaign: utmCampaign.slice(0, 120),
      deviceType: getDeviceType(),
      conversionValue: typeof value === 'number' && value >= 0 ? value : 0
    });

    if (typeof fetch === 'function') {
      fetch('${endpoint}', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: payload,
        keepalive: true,
        mode: 'cors'
      }).catch(function() {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('${endpoint}', new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
        }
      });
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon('${endpoint}', new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
    }
  }

  w.rankpilot = {
    _initialized: true,
    trackPageview: function(path) { send('pageview', 0, path); },
    trackConversion: function(type, value) {
      var allowed = ['conversion', 'lead_submit', 'quote_request'];
      var ev = allowed.indexOf(type) !== -1 ? type : 'conversion';
      send(ev, Number(value) || 0);
    }
  };

  send('pageview', 0);
})(window, document);`;

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(script);
  });

  // ---------------------------------------------------------------------------
  // 12. Public Visitor Tracking Event Ingestion (/api/track) — PUBLIC
  // ---------------------------------------------------------------------------
  app.options('/api/track', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
  });

  app.post('/api/track', trackLimiter, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      let body: Record<string, unknown> = {};
      if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body);
        } catch {
          res.status(400).json({ error: 'Malformed JSON tracking payload.' });
          return;
        }
      } else if (req.body && typeof req.body === 'object') {
        body = req.body as Record<string, unknown>;
      }

      const trackingId = String(body.trackingId || '').trim();
      if (!/^[a-zA-Z0-9_-]{6,64}$/.test(trackingId)) {
        res.status(400).json({ error: 'Invalid trackingId format.' });
        return;
      }

      const cfg = getFirebaseConfig();
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents`;

      const keyRes = await fetch(
        `${baseUrl}/trackingKeys/${encodeURIComponent(trackingId)}?key=${encodeURIComponent(cfg.apiKey)}`
      );
      if (!keyRes.ok) {
        res.status(404).json({ error: 'Tracking ID not registered.' });
        return;
      }
      const keyDoc = await keyRes.json();
      const ownerId = keyDoc?.fields?.ownerId?.stringValue;
      const websiteId = keyDoc?.fields?.websiteId?.stringValue;
      if (!ownerId || !websiteId) {
        res.status(404).json({ error: 'Invalid tracking key record.' });
        return;
      }

      const allowedEventTypes = ['pageview', 'conversion', 'lead_submit', 'quote_request'];
      const eventType = allowedEventTypes.includes(String(body.eventType))
        ? String(body.eventType)
        : 'pageview';
      const allowedDevices = ['desktop', 'mobile', 'tablet'];
      const deviceType = allowedDevices.includes(String(body.deviceType))
        ? String(body.deviceType)
        : 'desktop';
      const conversionValue =
        Number.isFinite(Number(body.conversionValue)) && Number(body.conversionValue) >= 0
          ? Math.min(10000000, Number(body.conversionValue))
          : 0;

      const visitorId = String(body.visitorId || '').trim().slice(0, 128) || 'v_anon';
      const sessionId = String(body.sessionId || '').trim().slice(0, 128) || 's_anon';
      const reqPath = String(body.path || '/').trim().slice(0, 500) || '/';
      const trafficSource = String(body.trafficSource || 'Direct').trim().slice(0, 80) || 'Direct';

      const eventId = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const docPath = `projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/visitorEvents/${eventId}`;

      const commitRes = await fetch(`${baseUrl}:commit?key=${encodeURIComponent(cfg.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [
            {
              update: {
                name: docPath,
                fields: {
                  ownerId: { stringValue: ownerId },
                  websiteId: { stringValue: websiteId },
                  trackingId: { stringValue: trackingId },
                  visitorId: { stringValue: visitorId },
                  sessionId: { stringValue: sessionId },
                  eventType: { stringValue: eventType },
                  path: { stringValue: reqPath },
                  referrer: { stringValue: String(body.referrer || '').slice(0, 500) },
                  trafficSource: { stringValue: trafficSource },
                  utmSource: { stringValue: String(body.utmSource || '').slice(0, 120) },
                  utmMedium: { stringValue: String(body.utmMedium || '').slice(0, 120) },
                  utmCampaign: { stringValue: String(body.utmCampaign || '').slice(0, 120) },
                  deviceType: { stringValue: deviceType },
                  conversionValue: { doubleValue: conversionValue },
                },
              },
              updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ],
        }),
      });

      if (!commitRes.ok) {
        const errText = await commitRes.text();
        console.error('Firestore REST commit failed:', errText);
        res.status(502).json({ error: 'Failed to persist tracking event.' });
        return;
      }

      res.status(201).json({ ok: true, eventId });
    } catch (err) {
      console.error('Track ingest error:', err);
      res.status(500).json({ error: 'Tracking ingestion error.' });
    }
  });

  return app;
}
