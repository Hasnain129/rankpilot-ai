import express from 'express';
import fs from 'fs';
import path from 'path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { GoogleGenAI, Type } from '@google/genai';

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

function getFirebaseConfig(): FirebaseAppletConfig {
  const envProjectId = process.env.FIREBASE_PROJECT_ID;
  const envApiKey = process.env.FIREBASE_API_KEY;
  const envDbId = process.env.FIREBASE_DATABASE_ID;
  if (envProjectId && envApiKey && envDbId) {
    return {
      projectId: envProjectId,
      apiKey: envApiKey,
      firestoreDatabaseId: envDbId,
    };
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(currentDir, '..', 'firebase-applet-config.json'),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return {
        projectId: raw.projectId,
        apiKey: raw.apiKey,
        firestoreDatabaseId: raw.firestoreDatabaseId || '(default)',
      };
    }
  }
  throw new Error('Firebase configuration file or environment variables not found.');
}

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
      return { status: 503, message: 'AI model is temporarily experiencing high demand. Please try again in a moment.' };
    }
    if (rawMsg.includes('429') || rawMsg.toLowerCase().includes('resource_exhausted')) {
      return { status: 429, message: 'Gemini API rate limit reached. Please wait briefly and try again.' };
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

// Simple sliding-window in-memory rate limiter
const rateBuckets = new Map<string, number[]>();
function createRateLimiter(limit: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const recent = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= limit) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    if (rateBuckets.size > 2000) {
      rateBuckets.clear();
    }
    next();
  };
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  if (lower.startsWith('::ffff:')) {
    return isPrivateIp(lower.slice(7));
  }
  return false;
}

async function validatePublicHttpUrl(inputUrl: string): Promise<URL> {
  const normalized = inputUrl.trim().match(/^https?:\/\//i)
    ? inputUrl.trim()
    : `https://${inputUrl.trim()}`;
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported.');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (net.isIP(host) && isPrivateIp(host))
  ) {
    throw new Error('Private or loopback network URLs cannot be crawled.');
  }

  try {
    const resolved = await dns.lookup(host, { all: true });
    if (resolved.some((addr) => isPrivateIp(addr.address))) {
      throw new Error('Target domain resolves to a restricted internal network address.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('restricted internal network')) {
      throw err;
    }
    // Let fetch surface DNS resolution error clearly if lookup fails
  }
  return parsed;
}

async function safePublicFetch(
  initialUrl: URL,
  init: Omit<RequestInit, 'redirect'>,
  maxRedirects = 4
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(currentUrl.toString(), { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hop === maxRedirects) {
        return res;
      }
      const nextRaw = new URL(location, currentUrl.toString()).toString();
      currentUrl = await validatePublicHttpUrl(nextRaw);
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}

async function checkLinkStatus(targetUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const validatedUrl = await validatePublicHttpUrl(targetUrl);
    let res = await safePublicFetch(validatedUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'RankPilotBot/1.0 (+https://rankpilot.app)' },
    });
    if (res.status === 405 || res.status === 403) {
      res = await safePublicFetch(validatedUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'RankPilotBot/1.0 (+https://rankpilot.app)' },
      });
    }
    return res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: 'text/plain', limit: '64kb' }));

  const aiLimiter = createRateLimiter(20, 60_000);
  const trackLimiter = createRateLimiter(120, 60_000);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'RankPilot AI', timestamp: new Date().toISOString() });
  });

  // ---------------------------------------------------------------------------
  // 1. Live Website Crawler + Gemini AI SEO Analyzer
  // ---------------------------------------------------------------------------
  app.post('/api/seo/analyze', aiLimiter, async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== 'string' || url.trim().length > 500) {
        res.status(400).json({ error: 'A valid website URL (max 500 chars) is required.' });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = await validatePublicHttpUrl(url);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid URL.' });
        return;
      }

      const startTime = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      let html = '';
      let httpStatus = 0;
      let loadTimeMs = 0;

      try {
        const fetchRes = await safePublicFetch(parsedUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RankPilotSEO/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });
        httpStatus = fetchRes.status;
        html = await fetchRes.text();
        loadTimeMs = Date.now() - startTime;
      } catch (err) {
        clearTimeout(timeout);
        const msg = err instanceof Error ? err.message : 'Network error';
        const isSsrfBlock = msg.includes('Private or loopback') || msg.includes('restricted internal') || msg.includes('Only http and https');
        res.status(isSsrfBlock ? 400 : 502).json({
          error: isSsrfBlock ? msg : `Could not reach ${parsedUrl.hostname}. Ensure the URL is publicly accessible (${msg}).`,
        });
        return;
      } finally {
        clearTimeout(timeout);
      }

      const $ = cheerio.load(html);
      const title = $('title').first().text().trim().slice(0, 300);
      const metaDescription = ($('meta[name="description"]').attr('content') || '').trim().slice(0, 600);
      const h1Count = $('h1').length;
      const h2Count = $('h2').length;
      const h3Count = $('h3').length;

      const bodyClone = $('body').clone();
      bodyClone.find('script, style, noscript, svg').remove();
      const bodyText = bodyClone.text().replace(/\s+/g, ' ').trim();
      const wordCount = bodyText ? bodyText.split(' ').length : 0;

      const images = $('img');
      const totalImages = images.length;
      let missingAltCount = 0;
      images.each((_, el) => {
        const alt = $(el).attr('alt');
        if (!alt || alt.trim().length === 0) {
          missingAltCount++;
        }
      });

      const hasViewport = $('meta[name="viewport"]').length > 0;
      const hasCanonical = $('link[rel="canonical"]').length > 0;
      const hasOpenGraph = $('meta[property="og:title"]').length > 0 || $('meta[property="og:description"]').length > 0;
      const mobileFriendly = hasViewport;

      let internalLinks = 0;
      let externalLinks = 0;
      const linksToProbe: string[] = [];

      $('a[href]').each((_, el) => {
        const href = ($(el).attr('href') || '').trim();
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
          return;
        }
        try {
          const resolved = new URL(href, parsedUrl.toString());
          if (resolved.hostname === parsedUrl.hostname) {
            internalLinks++;
          } else {
            externalLinks++;
          }
          if (linksToProbe.length < 8 && (resolved.protocol === 'http:' || resolved.protocol === 'https:')) {
            if (!linksToProbe.includes(resolved.toString())) {
              linksToProbe.push(resolved.toString());
            }
          }
        } catch {
          // Ignore malformed hrefs
        }
      });

      const linkStatuses = await Promise.all(
        linksToProbe.map(async (linkUrl) => ({
          linkUrl,
          ok: await checkLinkStatus(linkUrl),
        }))
      );
      const brokenLinks = linkStatuses.filter((l) => !l.ok).map((l) => l.linkUrl);
      const brokenLinksCount = brokenLinks.length;

      const issues: Array<{ severity: 'critical' | 'warning' | 'passed'; category: string; title: string; detail: string }> = [];
      let score = 100;

      if (httpStatus >= 400 || httpStatus === 0) {
        score -= 30;
        issues.push({ severity: 'critical', category: 'Availability', title: `HTTP ${httpStatus} response`, detail: 'The page returned an HTTP error status code.' });
      } else {
        issues.push({ severity: 'passed', category: 'Availability', title: `HTTP ${httpStatus} OK`, detail: 'Page responded with a valid success status.' });
      }

      if (!title) {
        score -= 15;
        issues.push({ severity: 'critical', category: 'Meta Tags', title: 'Missing <title> tag', detail: 'Every indexable page requires a unique descriptive title tag.' });
      } else if (title.length < 20 || title.length > 65) {
        score -= 6;
        issues.push({ severity: 'warning', category: 'Meta Tags', title: `Title length (${title.length} chars)`, detail: 'Recommended page title length is between 30 and 60 characters.' });
      } else {
        issues.push({ severity: 'passed', category: 'Meta Tags', title: 'Title tag length optimal', detail: `Title is ${title.length} characters.` });
      }

      if (!metaDescription) {
        score -= 12;
        issues.push({ severity: 'critical', category: 'Meta Tags', title: 'Missing meta description', detail: 'Add a 120–155 character meta description to improve search CTR.' });
      } else if (metaDescription.length < 70 || metaDescription.length > 165) {
        score -= 5;
        issues.push({ severity: 'warning', category: 'Meta Tags', title: `Meta description length (${metaDescription.length} chars)`, detail: 'Aim for 120–160 characters so search snippets do not truncate.' });
      } else {
        issues.push({ severity: 'passed', category: 'Meta Tags', title: 'Meta description present', detail: `Length is ${metaDescription.length} characters.` });
      }

      if (h1Count === 0) {
        score -= 12;
        issues.push({ severity: 'critical', category: 'Headings', title: 'Missing H1 heading', detail: 'Include one primary H1 tag clearly describing the page topic.' });
      } else if (h1Count > 1) {
        score -= 5;
        issues.push({ severity: 'warning', category: 'Headings', title: `Multiple H1 tags detected (${h1Count})`, detail: 'Consolidate into a single primary H1 heading for clearer hierarchy.' });
      } else {
        issues.push({ severity: 'passed', category: 'Headings', title: 'Single H1 structure', detail: `Detected 1 H1, ${h2Count} H2, and ${h3Count} H3 headings.` });
      }

      if (missingAltCount > 0) {
        score -= Math.min(12, missingAltCount * 2);
        issues.push({ severity: 'warning', category: 'Accessibility & Images', title: `${missingAltCount} of ${totalImages} images missing alt text`, detail: 'Descriptive alt attributes help image search rankings and screen readers.' });
      } else if (totalImages > 0) {
        issues.push({ severity: 'passed', category: 'Accessibility & Images', title: 'All images have alt attributes', detail: `Checked ${totalImages} image elements.` });
      }

      if (!hasViewport) {
        score -= 10;
        issues.push({ severity: 'critical', category: 'Mobile Readiness', title: 'Missing viewport meta tag', detail: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' });
      } else {
        issues.push({ severity: 'passed', category: 'Mobile Readiness', title: 'Mobile viewport configured', detail: 'Responsive viewport meta tag detected.' });
      }

      if (!hasCanonical) {
        score -= 5;
        issues.push({ severity: 'warning', category: 'Technical SEO', title: 'Missing canonical link tag', detail: 'Set a rel="canonical" link to prevent duplicate URL indexing.' });
      } else {
        issues.push({ severity: 'passed', category: 'Technical SEO', title: 'Canonical tag configured', detail: 'Canonical URL hint is present.' });
      }

      if (!hasOpenGraph) {
        score -= 4;
        issues.push({ severity: 'warning', category: 'Social & Metadata', title: 'Missing Open Graph tags', detail: 'Add og:title and og:description for clean social link previews.' });
      }

      if (brokenLinksCount > 0) {
        score -= Math.min(15, brokenLinksCount * 5);
        issues.push({ severity: 'critical', category: 'Links', title: `${brokenLinksCount} broken sampled link(s) detected`, detail: `Sampled links returned errors: ${brokenLinks.slice(0, 3).join(', ')}` });
      } else if (linksToProbe.length > 0) {
        issues.push({ severity: 'passed', category: 'Links', title: 'Sampled links healthy', detail: `Verified ${linksToProbe.length} links with 0 errors.` });
      }

      if (loadTimeMs > 2500) {
        score -= 10;
        issues.push({ severity: 'warning', category: 'Performance', title: `Slow HTML response (${loadTimeMs} ms)`, detail: 'Improve server TTFB and caching to stay under 1,000 ms.' });
      } else {
        issues.push({ severity: 'passed', category: 'Performance', title: `Fast HTML response (${loadTimeMs} ms)`, detail: 'Initial document fetched quickly.' });
      }

      score = Math.max(0, Math.min(100, score));

      let recommendations: Array<{ priority: string; title: string; impact: string; actionSteps: string }> = [];
      let summary = `Technical scan completed for ${parsedUrl.hostname} with a score of ${score}/100.`;

      try {
        const ai = getGeminiClient();
        const prompt = `Analyze these real crawled technical SEO metrics for ${parsedUrl.toString()} and produce prioritized, concrete recommendations:
- HTTP Status: ${httpStatus}
- HTML Load Time: ${loadTimeMs}ms
- Title: "${title}"
- Meta Description: "${metaDescription}"
- Headings: H1=${h1Count}, H2=${h2Count}, H3=${h3Count}
- Word Count: ${wordCount}
- Images: ${totalImages} total, ${missingAltCount} missing alt
- Links: ${internalLinks} internal, ${externalLinks} external, ${brokenLinksCount} broken sampled
- Viewport Meta: ${hasViewport}, Canonical: ${hasCanonical}, OpenGraph: ${hasOpenGraph}
- Computed Technical Score: ${score}/100

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
        console.error('Gemini SEO recommendation error:', aiErr);
        recommendations = [
          {
            priority: 'High',
            title: 'Address flagged technical SEO items',
            impact: 'Improves crawlability and search snippet CTR',
            actionSteps: 'Review missing meta tags, heading hierarchy, and alt attributes in the technical audit table.',
          },
        ];
      }

      res.json({
        url: parsedUrl.toString(),
        domain: parsedUrl.hostname,
        score,
        loadTimeMs,
        httpStatus,
        title,
        metaDescription,
        h1Count,
        h2Count,
        h3Count,
        wordCount,
        totalImages,
        missingAltCount,
        internalLinks,
        externalLinks,
        brokenLinksCount,
        brokenLinks: brokenLinks.slice(0, 20),
        hasViewport,
        hasCanonical,
        hasOpenGraph,
        mobileFriendly,
        issues: issues.slice(0, 30),
        recommendations: recommendations.slice(0, 20),
        summary,
      });
    } catch (err) {
      console.error('SEO analyze error:', err);
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Gemini AI Keyword Research
  // ---------------------------------------------------------------------------
  app.post('/api/ai/keywords', aiLimiter, async (req, res) => {
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

Important: Do NOT invent fake exact monthly search volumes. Instead classify search intent, estimated competition level (Low/Medium/High), topic clusters, and high-converting content ideas.`,
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
                      keywords: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
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
                suggestedTitles: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
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
      console.error('AI keyword error:', err);
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Gemini AI Content Generator
  // ---------------------------------------------------------------------------
  app.post('/api/ai/content', aiLimiter, async (req, res) => {
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

      const formatInstruction = formatMap[contentType || 'blog'];

      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Write ${formatInstruction}.
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
      console.error('AI content error:', err);
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Lightweight Website Visitor Tracking Script (/track.js)
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
  // 5. Public Visitor Tracking Event Ingestion (/api/track)
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

      const keyRes = await fetch(`${baseUrl}/trackingKeys/${encodeURIComponent(trackingId)}?key=${encodeURIComponent(cfg.apiKey)}`);
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
      const eventType = allowedEventTypes.includes(String(body.eventType)) ? String(body.eventType) : 'pageview';
      const allowedDevices = ['desktop', 'mobile', 'tablet'];
      const deviceType = allowedDevices.includes(String(body.deviceType)) ? String(body.deviceType) : 'desktop';
      const conversionValue = Number.isFinite(Number(body.conversionValue)) && Number(body.conversionValue) >= 0
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
              updateTransforms: [
                {
                  fieldPath: 'createdAt',
                  setToServerValue: 'REQUEST_TIME',
                },
              ],
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
