import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';

export type CrawledPageType = 'product' | 'category' | 'blog' | 'landing' | 'other';

export interface CrawledPageReport {
  url: string;
  pageType: CrawledPageType;
  httpStatus: number;
  loadTimeMs: number;
  title: string;
  metaDescription: string;
  h1: string;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  canonicalUrl: string;
  hasCanonical: boolean;
  noindex: boolean;
  wordCount: number;
  totalImages: number;
  missingAltCount: number;
  internalLinks: number;
  externalLinks: number;
  brokenLinksCount: number;
  schemaTypes: string[];
  mobileFriendly: boolean;
  score: number;
  issuesCount: number;
  contentHash: string;
  bodyExcerpt: string;
  imageAltsMissingSample: string[];
}

export interface SiteCrawlResult {
  rootUrl: string;
  domain: string;
  pagesCrawled: number;
  overallScore: number;
  robotsTxtFound: boolean;
  robotsBlockingAll: boolean;
  sitemapFound: boolean;
  sitemapUrlsCount: number;
  duplicateTitlesCount: number;
  duplicateMetaCount: number;
  noindexCount: number;
  brokenLinksCount: number;
  pages: Array<{
    url: string;
    pageType: CrawledPageType;
    httpStatus: number;
    loadTimeMs: number;
    title: string;
    metaDescription: string;
    h1: string;
    h1Count: number;
    canonicalUrl: string;
    noindex: boolean;
    wordCount: number;
    missingAltCount: number;
    brokenLinksCount: number;
    schemaTypes: string[];
    score: number;
    issuesCount: number;
  }>;
  siteIssues: Array<{
    severity: 'critical' | 'warning' | 'passed';
    category: string;
    title: string;
    detail: string;
    affectedCount: number;
  }>;
  summary: string;
}

export function isPrivateIp(ip: string): boolean {
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
  if (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fe80:') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  ) {
    return true;
  }
  if (lower.startsWith('::ffff:')) {
    return isPrivateIp(lower.slice(7));
  }
  return false;
}

export async function validatePublicHttpUrl(inputUrl: string): Promise<URL> {
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
  }
  return parsed;
}

export async function safePublicFetch(
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

export async function checkLinkStatus(targetUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3200);
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

export function classifyUrlPageType(rawUrl: string, schemaTypes: string[] = []): CrawledPageType {
  const lowerSchemas = schemaTypes.map((s) => s.toLowerCase());
  if (lowerSchemas.some((s) => s.includes('product'))) return 'product';
  if (lowerSchemas.some((s) => s.includes('blogposting') || s.includes('article') || s.includes('newsarticle'))) {
    return 'blog';
  }
  if (lowerSchemas.some((s) => s.includes('collectionpage') || s.includes('itemlist'))) {
    return 'category';
  }

  let pathname = '/';
  try {
    pathname = new URL(rawUrl).pathname.toLowerCase();
  } catch {
    pathname = rawUrl.toLowerCase();
  }
  if (pathname === '/' || pathname === '') return 'landing';
  if (/\/(product|products|shop\/[^/]+|item|p\/|sku)/i.test(pathname)) return 'product';
  if (/\/(product-category|category|categories|collection|collections|shop\/?$|catalog|tag\/)/i.test(pathname)) {
    return 'category';
  }
  if (/\/(blog|post|posts|article|articles|news|guide|guides|insights|resources|journal)\b/i.test(pathname)) {
    return 'blog';
  }
  if (/\/(pricing|features|solutions|about|contact|demo|services|landing|compare)/i.test(pathname)) {
    return 'landing';
  }
  return 'other';
}

function extractSchemaTypes($: cheerio.CheerioAPI): string[] {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const visit = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        const obj = node as Record<string, unknown>;
        if (typeof obj['@type'] === 'string') {
          types.add(obj['@type']);
        } else if (Array.isArray(obj['@type'])) {
          obj['@type'].forEach((t) => {
            if (typeof t === 'string') types.add(t);
          });
        }
        if (Array.isArray(obj['@graph'])) {
          obj['@graph'].forEach(visit);
        }
      };
      visit(parsed);
    } catch {
      // ignore invalid JSON-LD
    }
  });
  return Array.from(types).slice(0, 12);
}

export async function inspectPageRaw(targetUrl: string, probeLinksLimit = 4): Promise<{
  page: CrawledPageReport;
  discoveredInternalLinks: string[];
}> {
  const parsedUrl = await validatePublicHttpUrl(targetUrl);
  const startTime = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  let html = '';
  let httpStatus = 0;
  let loadTimeMs = 0;

  try {
    const res = await safePublicFetch(parsedUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RankPilotSEO/2.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    httpStatus = res.status;
    html = await res.text();
    loadTimeMs = Date.now() - startTime;
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(html);
  const title = $('title').first().text().trim().slice(0, 300);
  const metaDescription = ($('meta[name="description"]').attr('content') || '').trim().slice(0, 600);
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim().slice(0, 200);
  const h1Count = $('h1').length;
  const h2Count = $('h2').length;
  const h3Count = $('h3').length;

  const canonicalUrl = ($('link[rel="canonical"]').attr('href') || '').trim().slice(0, 500);
  const hasCanonical = canonicalUrl.length > 0;
  const robotsMeta = ($('meta[name="robots"]').attr('content') || '').toLowerCase();
  const noindex = robotsMeta.includes('noindex');
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const mobileFriendly = hasViewport;
  const schemaTypes = extractSchemaTypes($);

  const bodyClone = $('body').clone();
  bodyClone.find('script, style, noscript, svg').remove();
  const bodyText = bodyClone.text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText ? bodyText.split(' ').length : 0;
  const contentHash = crypto
    .createHash('sha1')
    .update(bodyText.toLowerCase().slice(0, 4000))
    .digest('hex')
    .slice(0, 12);

  const images = $('img');
  const totalImages = images.length;
  let missingAltCount = 0;
  const imageAltsMissingSample: string[] = [];
  images.each((_, el) => {
    const alt = $(el).attr('alt');
    if (!alt || alt.trim().length === 0) {
      missingAltCount++;
      if (imageAltsMissingSample.length < 5) {
        const src = $(el).attr('src') || $(el).attr('data-src') || 'unnamed-image';
        imageAltsMissingSample.push(src.slice(0, 140));
      }
    }
  });

  let internalLinks = 0;
  let externalLinks = 0;
  const discoveredInternalLinks: string[] = [];
  const linksToProbe: string[] = [];
  const baseHost = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:')
    ) {
      return;
    }
    try {
      const resolved = new URL(href, parsedUrl.toString());
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
      resolved.hash = '';
      const resolvedHost = resolved.hostname.replace(/^www\./, '').toLowerCase();
      if (resolvedHost === baseHost) {
        internalLinks++;
        const clean = resolved.toString();
        if (
          !clean.match(/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|xml|ico)(\?|$)/i) &&
          !discoveredInternalLinks.includes(clean)
        ) {
          discoveredInternalLinks.push(clean);
        }
      } else {
        externalLinks++;
      }
      if (linksToProbe.length < probeLinksLimit && !linksToProbe.includes(resolved.toString())) {
        linksToProbe.push(resolved.toString());
      }
    } catch {
      // ignore invalid href
    }
  });

  let brokenLinksCount = 0;
  if (linksToProbe.length > 0) {
    const statuses = await Promise.all(linksToProbe.map((u) => checkLinkStatus(u)));
    brokenLinksCount = statuses.filter((ok) => !ok).length;
  }

  let score = 100;
  let issuesCount = 0;
  if (httpStatus >= 400 || httpStatus === 0) {
    score -= 35;
    issuesCount++;
  }
  if (!title) {
    score -= 15;
    issuesCount++;
  } else if (title.length < 20 || title.length > 65) {
    score -= 6;
    issuesCount++;
  }
  if (!metaDescription) {
    score -= 12;
    issuesCount++;
  } else if (metaDescription.length < 70 || metaDescription.length > 165) {
    score -= 5;
    issuesCount++;
  }
  if (h1Count !== 1) {
    score -= h1Count === 0 ? 12 : 5;
    issuesCount++;
  }
  if (missingAltCount > 0) {
    score -= Math.min(10, missingAltCount * 2);
    issuesCount++;
  }
  if (!hasViewport) {
    score -= 10;
    issuesCount++;
  }
  if (!hasCanonical) {
    score -= 5;
    issuesCount++;
  }
  if (noindex) {
    score -= 15;
    issuesCount++;
  }
  if (wordCount < 120) {
    score -= 6;
    issuesCount++;
  }
  if (brokenLinksCount > 0) {
    score -= Math.min(12, brokenLinksCount * 5);
    issuesCount++;
  }
  if (loadTimeMs > 2500) {
    score -= 8;
    issuesCount++;
  }

  score = Math.max(0, Math.min(100, score));
  const pageType = classifyUrlPageType(parsedUrl.toString(), schemaTypes);

  return {
    page: {
      url: parsedUrl.toString(),
      pageType,
      httpStatus,
      loadTimeMs,
      title,
      metaDescription,
      h1,
      h1Count,
      h2Count,
      h3Count,
      canonicalUrl,
      hasCanonical,
      noindex,
      wordCount,
      totalImages,
      missingAltCount,
      internalLinks,
      externalLinks,
      brokenLinksCount,
      schemaTypes,
      mobileFriendly,
      score,
      issuesCount,
      contentHash,
      bodyExcerpt: bodyText.slice(0, 1200),
      imageAltsMissingSample,
    },
    discoveredInternalLinks,
  };
}

export async function inspectRobotsAndSitemap(originUrl: URL): Promise<{
  robotsTxtFound: boolean;
  robotsBlockingAll: boolean;
  sitemapFound: boolean;
  sitemapUrls: string[];
}> {
  let robotsTxtFound = false;
  let robotsBlockingAll = false;
  const sitemapCandidates: string[] = [];

  try {
    const robotsUrl = new URL('/robots.txt', originUrl.origin);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    try {
      const res = await safePublicFetch(robotsUrl, {
        method: 'GET',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'RankPilotBot/1.0' },
      });
      if (res.ok) {
        const text = await res.text();
        if (text && !text.trim().startsWith('<')) {
          robotsTxtFound = true;
          const lines = text.split(/\r?\n/);
          let inGlobalStar = false;
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            if (/^user-agent:\s*\*/i.test(line)) {
              inGlobalStar = true;
            } else if (/^user-agent:/i.test(line)) {
              inGlobalStar = false;
            } else if (inGlobalStar && /^disallow:\s*\/\s*$/i.test(line)) {
              robotsBlockingAll = true;
            } else if (/^sitemap:\s*(https?:\/\/\S+)/i.test(line)) {
              const sm = line.replace(/^sitemap:\s*/i, '').trim();
              if (!sitemapCandidates.includes(sm)) sitemapCandidates.push(sm);
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // ignore robots errors
  }

  if (sitemapCandidates.length === 0) {
    sitemapCandidates.push(new URL('/sitemap.xml', originUrl.origin).toString());
    sitemapCandidates.push(new URL('/sitemap_index.xml', originUrl.origin).toString());
  }

  let sitemapFound = false;
  const discoveredUrls: string[] = [];
  const baseHost = originUrl.hostname.replace(/^www\./, '').toLowerCase();

  const parseSitemapXml = async (smUrl: string, depth: number) => {
    if (depth > 1 || discoveredUrls.length >= 200) return;
    try {
      const validated = await validatePublicHttpUrl(smUrl);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4500);
      try {
        const res = await safePublicFetch(validated, {
          method: 'GET',
          signal: ctrl.signal,
          headers: { 'User-Agent': 'RankPilotBot/1.0' },
        });
        if (!res.ok) return;
        const xml = await res.text();
        if (!xml.includes('<urlset') && !xml.includes('<sitemapindex')) return;
        sitemapFound = true;
        const $ = cheerio.load(xml, { xmlMode: true });
        const childSitemaps: string[] = [];
        $('sitemap > loc').each((_, el) => {
          const loc = $(el).text().trim();
          if (loc && childSitemaps.length < 3) childSitemaps.push(loc);
        });
        $('url > loc').each((_, el) => {
          const loc = $(el).text().trim();
          try {
            const u = new URL(loc);
            if (u.hostname.replace(/^www\./, '').toLowerCase() === baseHost) {
              if (!discoveredUrls.includes(u.toString()) && discoveredUrls.length < 200) {
                discoveredUrls.push(u.toString());
              }
            }
          } catch {
            // ignore
          }
        });
        for (const child of childSitemaps) {
          await parseSitemapXml(child, depth + 1);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // ignore invalid sitemap
    }
  };

  for (const sm of sitemapCandidates.slice(0, 3)) {
    await parseSitemapXml(sm, 0);
    if (sitemapFound && discoveredUrls.length > 0) break;
  }

  return {
    robotsTxtFound,
    robotsBlockingAll,
    sitemapFound,
    sitemapUrls: discoveredUrls,
  };
}

export async function crawlEntireSite(params: {
  rootUrl: string;
  maxPages?: number;
}): Promise<SiteCrawlResult> {
  const maxPages = Math.max(1, Math.min(25, Number(params.maxPages) || 15));
  const parsedRoot = await validatePublicHttpUrl(params.rootUrl);

  const robotsAndSitemap = await inspectRobotsAndSitemap(parsedRoot);

  const queue: string[] = [parsedRoot.toString()];
  // Seed diverse URLs from sitemap (products, categories, blog, landing)
  for (const smUrl of robotsAndSitemap.sitemapUrls) {
    if (!queue.includes(smUrl)) {
      queue.push(smUrl);
    }
    if (queue.length >= maxPages * 3) break;
  }

  const visited = new Set<string>();
  const crawledPages: CrawledPageReport[] = [];

  while (queue.length > 0 && crawledPages.length < maxPages) {
    const batchSize = Math.min(4, maxPages - crawledPages.length, queue.length);
    const batch: string[] = [];
    while (batch.length < batchSize && queue.length > 0) {
      const next = queue.shift()!;
      const norm = next.replace(/\/$/, '');
      if (!visited.has(norm)) {
        visited.add(norm);
        batch.push(next);
      }
    }
    if (batch.length === 0) break;

    const results = await Promise.allSettled(
      batch.map((target) => inspectPageRaw(target, 3))
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        crawledPages.push(r.value.page);
        for (const link of r.value.discoveredInternalLinks) {
          const normLink = link.replace(/\/$/, '');
          if (!visited.has(normLink) && !queue.includes(link) && queue.length < 150) {
            queue.push(link);
          }
        }
      }
    }
  }

  if (crawledPages.length === 0) {
    throw new Error(`Could not reach ${parsedRoot.hostname} to perform site crawl.`);
  }

  // Cross-page duplicate detection
  const titleMap = new Map<string, number>();
  const metaMap = new Map<string, number>();
  let noindexCount = 0;
  let brokenLinksCount = 0;
  let missingTitles = 0;
  let missingMetas = 0;
  let missingH1 = 0;
  let missingCanonical = 0;
  let missingAltPages = 0;
  let noSchemaPages = 0;

  for (const p of crawledPages) {
    const cleanTitle = p.title.trim().toLowerCase();
    if (cleanTitle) titleMap.set(cleanTitle, (titleMap.get(cleanTitle) || 0) + 1);
    else missingTitles++;

    const cleanMeta = p.metaDescription.trim().toLowerCase();
    if (cleanMeta) metaMap.set(cleanMeta, (metaMap.get(cleanMeta) || 0) + 1);
    else missingMetas++;

    if (p.noindex) noindexCount++;
    if (p.h1Count === 0) missingH1++;
    if (!p.hasCanonical) missingCanonical++;
    if (p.missingAltCount > 0) missingAltPages++;
    if (p.schemaTypes.length === 0) noSchemaPages++;
    brokenLinksCount += p.brokenLinksCount;
  }

  let duplicateTitlesCount = 0;
  for (const count of titleMap.values()) {
    if (count > 1) duplicateTitlesCount += count - 1;
  }
  let duplicateMetaCount = 0;
  for (const count of metaMap.values()) {
    if (count > 1) duplicateMetaCount += count - 1;
  }

  const siteIssues: SiteCrawlResult['siteIssues'] = [];
  if (robotsAndSitemap.robotsBlockingAll) {
    siteIssues.push({
      severity: 'critical',
      category: 'Indexing',
      title: 'robots.txt blocks entire site (Disallow: /)',
      detail: 'Search engines are instructed not to crawl your pages. Update robots.txt immediately.',
      affectedCount: crawledPages.length,
    });
  } else {
    siteIssues.push({
      severity: robotsAndSitemap.robotsTxtFound ? 'passed' : 'warning',
      category: 'Indexing',
      title: robotsAndSitemap.robotsTxtFound ? 'robots.txt found and crawlable' : 'No robots.txt file detected',
      detail: robotsAndSitemap.robotsTxtFound
        ? 'Crawlers are permitted to access site paths.'
        : 'Publish a /robots.txt file referencing your XML sitemap.',
      affectedCount: 1,
    });
  }

  if (!robotsAndSitemap.sitemapFound) {
    siteIssues.push({
      severity: 'warning',
      category: 'Crawlability',
      title: 'XML Sitemap not found',
      detail: 'Add /sitemap.xml (or Yoast/Rank Math sitemap index) so Google discovers product and blog URLs faster.',
      affectedCount: 1,
    });
  } else {
    siteIssues.push({
      severity: 'passed',
      category: 'Crawlability',
      title: `XML Sitemap active (${robotsAndSitemap.sitemapUrls.length} URLs sampled)`,
      detail: 'Valid XML sitemap discovered and parsed.',
      affectedCount: robotsAndSitemap.sitemapUrls.length,
    });
  }

  if (noindexCount > 0) {
    siteIssues.push({
      severity: 'critical',
      category: 'Indexing',
      title: `${noindexCount} crawled page(s) carry meta robots noindex`,
      detail: 'Verify no important product, category, or landing page accidentally blocks search indexing.',
      affectedCount: noindexCount,
    });
  }

  if (duplicateTitlesCount > 0) {
    siteIssues.push({
      severity: 'critical',
      category: 'Duplicates',
      title: `${duplicateTitlesCount} duplicate page title(s) across crawled URLs`,
      detail: 'Unique titles per URL prevent keyword cannibalization and improve SERP CTR.',
      affectedCount: duplicateTitlesCount,
    });
  }

  if (duplicateMetaCount > 0) {
    siteIssues.push({
      severity: 'warning',
      category: 'Duplicates',
      title: `${duplicateMetaCount} duplicate meta description(s)`,
      detail: 'Write unique conversion-oriented descriptions tailored to each product or page.',
      affectedCount: duplicateMetaCount,
    });
  }

  if (missingTitles > 0 || missingMetas > 0) {
    siteIssues.push({
      severity: 'critical',
      category: 'On-Page Metadata',
      title: `${missingTitles} missing <title>, ${missingMetas} missing meta description(s)`,
      detail: 'Use RankPilot Optimization Center to draft and apply missing metadata.',
      affectedCount: Math.max(missingTitles, missingMetas),
    });
  }

  if (missingH1 > 0) {
    siteIssues.push({
      severity: 'warning',
      category: 'Heading Structure',
      title: `${missingH1} page(s) missing an H1 heading`,
      detail: 'Ensure every indexable page renders one clear H1 containing its primary target topic.',
      affectedCount: missingH1,
    });
  }

  if (missingCanonical > 0) {
    siteIssues.push({
      severity: 'warning',
      category: 'Technical SEO',
      title: `${missingCanonical} page(s) lack rel="canonical"`,
      detail: 'Explicit canonical URLs consolidate link equity across filter/UTM parameter variants.',
      affectedCount: missingCanonical,
    });
  }

  if (missingAltPages > 0) {
    siteIssues.push({
      severity: 'warning',
      category: 'Accessibility & Image SEO',
      title: `${missingAltPages} page(s) contain images missing alt text`,
      detail: 'Add descriptive alt tags to product and editorial images.',
      affectedCount: missingAltPages,
    });
  }

  if (brokenLinksCount > 0) {
    siteIssues.push({
      severity: 'critical',
      category: 'Broken Links',
      title: `${brokenLinksCount} broken sampled link(s) discovered`,
      detail: 'Fix or redirect dead links hurting crawl budget and shopper trust.',
      affectedCount: brokenLinksCount,
    });
  }

  if (noSchemaPages > 0) {
    siteIssues.push({
      severity: 'warning',
      category: 'Structured Data',
      title: `${noSchemaPages} page(s) have no JSON-LD Schema markup`,
      detail: 'Add Product, FAQPage, or Article structured data to qualify for rich results.',
      affectedCount: noSchemaPages,
    });
  }

  const avgPageScore = Math.round(
    crawledPages.reduce((sum, p) => sum + p.score, 0) / crawledPages.length
  );
  const sitePenalty =
    (robotsAndSitemap.robotsBlockingAll ? 25 : 0) +
    Math.min(12, duplicateTitlesCount * 4) +
    Math.min(10, duplicateMetaCount * 3);
  const overallScore = Math.max(0, Math.min(100, avgPageScore - sitePenalty));

  const compactPages = crawledPages.slice(0, 25).map((p) => ({
    url: p.url.slice(0, 500),
    pageType: p.pageType,
    httpStatus: p.httpStatus,
    loadTimeMs: p.loadTimeMs,
    title: p.title.slice(0, 300),
    metaDescription: p.metaDescription.slice(0, 600),
    h1: p.h1.slice(0, 200),
    h1Count: p.h1Count,
    canonicalUrl: p.canonicalUrl.slice(0, 500),
    noindex: p.noindex,
    wordCount: p.wordCount,
    missingAltCount: p.missingAltCount,
    brokenLinksCount: p.brokenLinksCount,
    schemaTypes: p.schemaTypes,
    score: p.score,
    issuesCount: p.issuesCount,
  }));

  return {
    rootUrl: parsedRoot.toString(),
    domain: parsedRoot.hostname,
    pagesCrawled: crawledPages.length,
    overallScore,
    robotsTxtFound: robotsAndSitemap.robotsTxtFound,
    robotsBlockingAll: robotsAndSitemap.robotsBlockingAll,
    sitemapFound: robotsAndSitemap.sitemapFound,
    sitemapUrlsCount: robotsAndSitemap.sitemapUrls.length,
    duplicateTitlesCount,
    duplicateMetaCount,
    noindexCount,
    brokenLinksCount,
    pages: compactPages,
    siteIssues: siteIssues.slice(0, 30),
    summary: `Crawled ${crawledPages.length} page(s) across ${parsedRoot.hostname} with an overall SEO health score of ${overallScore}/100 (${duplicateTitlesCount} duplicate titles, ${duplicateMetaCount} duplicate metas, ${brokenLinksCount} broken links).`,
  };
}
