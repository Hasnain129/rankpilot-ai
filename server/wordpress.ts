import * as cheerio from 'cheerio';
import { safePublicFetch, validatePublicHttpUrl } from './crawler.ts';

export type DetectedSeoPlugin = 'rank_math' | 'yoast' | 'none';
export type WpEntityType = 'product' | 'category' | 'page' | 'post';

export interface WpSecrets {
  wpUsername: string;
  wpAppPassword: string;
  wcConsumerKey: string;
  wcConsumerSecret: string;
}

export interface ImportedWpEntity {
  remoteId: number;
  entityType: WpEntityType;
  title: string;
  slug: string;
  url: string;
  status: string;
  description: string;
  shortDescription: string;
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  seoPlugin: DetectedSeoPlugin;
  imagesCount: number;
  missingAltCount: number;
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

function stripHtmlSummary(html: string, maxLen = 25000): string {
  return (html || '').trim().slice(0, maxLen);
}

function countHtmlMissingAlts(html: string): { total: number; missing: number } {
  if (!html) return { total: 0, missing: 0 };
  const $ = cheerio.load(html);
  let total = 0;
  let missing = 0;
  $('img').each((_, el) => {
    total++;
    const alt = $(el).attr('alt');
    if (!alt || alt.trim().length === 0) missing++;
  });
  return { total, missing };
}

function extractSeoMeta(
  item: Record<string, unknown>,
  preferredPlugin: DetectedSeoPlugin
): { seoTitle: string; seoDescription: string; focusKeyword: string; detected: DetectedSeoPlugin } {
  // Check WP post `meta` object or WC `meta_data` array
  const metaObj = (item.meta && typeof item.meta === 'object' ? item.meta : {}) as Record<string, unknown>;
  const metaDataArr = Array.isArray(item.meta_data)
    ? (item.meta_data as Array<{ key?: string; value?: unknown }>)
    : [];

  const getMetaVal = (key: string): string => {
    if (metaObj[key] !== undefined && metaObj[key] !== null) return String(metaObj[key]);
    const found = metaDataArr.find((m) => m.key === key);
    return found && found.value !== undefined && found.value !== null ? String(found.value) : '';
  };

  const rmTitle = getMetaVal('rank_math_title');
  const rmDesc = getMetaVal('rank_math_description');
  const rmKw = getMetaVal('rank_math_focus_keyword');
  if (rmTitle || rmDesc || rmKw) {
    return {
      seoTitle: rmTitle.slice(0, 300),
      seoDescription: rmDesc.slice(0, 600),
      focusKeyword: rmKw.slice(0, 200),
      detected: 'rank_math',
    };
  }

  const yTitle = getMetaVal('_yoast_wpseo_title');
  const yDesc = getMetaVal('_yoast_wpseo_metadesc');
  const yKw = getMetaVal('_yoast_wpseo_focuskw');
  const yoastJson = item.yoast_head_json as Record<string, unknown> | undefined;
  if (yTitle || yDesc || yKw || yoastJson) {
    return {
      seoTitle: (yTitle || String(yoastJson?.title || '')).slice(0, 300),
      seoDescription: (yDesc || String(yoastJson?.description || '')).slice(0, 600),
      focusKeyword: yKw.slice(0, 200),
      detected: 'yoast',
    };
  }

  return {
    seoTitle: '',
    seoDescription: '',
    focusKeyword: '',
    detected: preferredPlugin,
  };
}

async function wpFetchJson(
  baseUrl: URL,
  endpointPath: string,
  authHeader: string,
  options: { method?: string; body?: unknown } = {}
): Promise<{ status: number; data: unknown; rawText: string }> {
  const fullUrl = await validatePublicHttpUrl(new URL(endpointPath, baseUrl.origin).toString());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await safePublicFetch(fullUrl, {
      method: options.method || 'GET',
      signal: ctrl.signal,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'RankPilotSync/1.0',
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const rawText = await res.text();
    let data: unknown = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data, rawText };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyWordPressConnection(params: {
  siteUrl: string;
  secrets: WpSecrets;
}): Promise<{
  normalizedSiteUrl: string;
  wpVerified: boolean;
  wcVerified: boolean;
  seoPlugin: DetectedSeoPlugin;
  message: string;
}> {
  const parsedUrl = await validatePublicHttpUrl(params.siteUrl);
  const { wpUsername, wpAppPassword, wcConsumerKey, wcConsumerSecret } = params.secrets;

  let wpVerified = false;
  let wcVerified = false;
  let seoPlugin: DetectedSeoPlugin = 'none';
  const notes: string[] = [];

  if (wpUsername && wpAppPassword) {
    const wpRes = await wpFetchJson(
      parsedUrl,
      '/wp-json/wp/v2/users/me',
      basicAuthHeader(wpUsername, wpAppPassword)
    );
    if (wpRes.status >= 200 && wpRes.status < 300) {
      wpVerified = true;
      notes.push('WordPress REST API authenticated');
    } else {
      throw new Error(
        `WordPress authentication failed (HTTP ${wpRes.status}). Confirm Application Password and REST API availability.`
      );
    }

    // Probe SEO plugin presence
    try {
      const rmProbe = await wpFetchJson(
        parsedUrl,
        '/wp-json/rankmath/v1/getHead?url=' + encodeURIComponent(parsedUrl.origin),
        basicAuthHeader(wpUsername, wpAppPassword)
      );
      if (rmProbe.status !== 404) {
        seoPlugin = 'rank_math';
      }
    } catch {
      // ignore
    }
    if (seoPlugin === 'none') {
      try {
        const postsProbe = await wpFetchJson(
          parsedUrl,
          '/wp-json/wp/v2/posts?per_page=1',
          basicAuthHeader(wpUsername, wpAppPassword)
        );
        if (postsProbe.status === 200 && Array.isArray(postsProbe.data) && postsProbe.data[0]) {
          const item = postsProbe.data[0] as Record<string, unknown>;
          if (item.yoast_head_json || item.yoast_head) {
            seoPlugin = 'yoast';
          } else {
            const metaKeys = Object.keys((item.meta as Record<string, unknown>) || {});
            if (metaKeys.some((k) => k.startsWith('rank_math'))) seoPlugin = 'rank_math';
            else if (metaKeys.some((k) => k.includes('yoast'))) seoPlugin = 'yoast';
          }
        }
      } catch {
        // ignore
      }
    }
  }

  if (wcConsumerKey && wcConsumerSecret) {
    const wcRes = await wpFetchJson(
      parsedUrl,
      '/wp-json/wc/v3/products?per_page=1',
      basicAuthHeader(wcConsumerKey, wcConsumerSecret)
    );
    if (wcRes.status >= 200 && wcRes.status < 300) {
      wcVerified = true;
      notes.push('WooCommerce v3 REST API authenticated');
      if (seoPlugin === 'none' && Array.isArray(wcRes.data) && wcRes.data[0]) {
        const prod = wcRes.data[0] as Record<string, unknown>;
        const extracted = extractSeoMeta(prod, 'none');
        seoPlugin = extracted.detected;
      }
    } else {
      throw new Error(
        `WooCommerce API authentication failed (HTTP ${wcRes.status}). Check Consumer Key, Secret, and Read/Write permissions.`
      );
    }
  }

  if (!wpVerified && !wcVerified) {
    throw new Error('Provide WordPress Application Password credentials and/or WooCommerce REST API keys.');
  }

  return {
    normalizedSiteUrl: parsedUrl.origin,
    wpVerified,
    wcVerified,
    seoPlugin,
    message: `${notes.join(' + ')}${seoPlugin !== 'none' ? ` · SEO plugin: ${seoPlugin}` : ''}.`,
  };
}

export async function importWordPressCatalog(params: {
  siteUrl: string;
  secrets: WpSecrets;
  preferredPlugin: DetectedSeoPlugin;
}): Promise<{ entities: ImportedWpEntity[]; warnings: string[] }> {
  const parsedUrl = await validatePublicHttpUrl(params.siteUrl);
  const { wpUsername, wpAppPassword, wcConsumerKey, wcConsumerSecret } = params.secrets;
  const entities: ImportedWpEntity[] = [];
  const warnings: string[] = [];

  if (wcConsumerKey && wcConsumerSecret) {
    const wcAuth = basicAuthHeader(wcConsumerKey, wcConsumerSecret);
    // Products
    try {
      const prodRes = await wpFetchJson(parsedUrl, '/wp-json/wc/v3/products?per_page=25', wcAuth);
      if (prodRes.status >= 200 && prodRes.status < 300 && Array.isArray(prodRes.data)) {
        for (const raw of prodRes.data as Array<Record<string, unknown>>) {
          const images = Array.isArray(raw.images)
            ? (raw.images as Array<{ alt?: string }>)
            : [];
          const missingImageAlts = images.filter((img) => !img.alt || !img.alt.trim()).length;
          const descHtml = String(raw.description || '');
          const htmlImgs = countHtmlMissingAlts(descHtml);
          const seo = extractSeoMeta(raw, params.preferredPlugin);

          entities.push({
            remoteId: Number(raw.id) || 0,
            entityType: 'product',
            title: String(raw.name || 'Untitled Product').slice(0, 300),
            slug: String(raw.slug || '').slice(0, 300),
            url: String(raw.permalink || `${parsedUrl.origin}/?p=${raw.id}`).slice(0, 500),
            status: String(raw.status || 'publish').slice(0, 40),
            description: stripHtmlSummary(descHtml),
            shortDescription: stripHtmlSummary(String(raw.short_description || ''), 5000),
            seoTitle: seo.seoTitle,
            seoDescription: seo.seoDescription,
            focusKeyword: seo.focusKeyword,
            seoPlugin: seo.detected,
            imagesCount: images.length + htmlImgs.total,
            missingAltCount: missingImageAlts + htmlImgs.missing,
          });
        }
      } else {
        warnings.push(`WooCommerce products returned HTTP ${prodRes.status}`);
      }
    } catch (err) {
      warnings.push(`Products import error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Categories
    try {
      const catRes = await wpFetchJson(
        parsedUrl,
        '/wp-json/wc/v3/products/categories?per_page=25',
        wcAuth
      );
      if (catRes.status >= 200 && catRes.status < 300 && Array.isArray(catRes.data)) {
        for (const raw of catRes.data as Array<Record<string, unknown>>) {
          const slug = String(raw.slug || '');
          const catUrl = `${parsedUrl.origin}/product-category/${slug || raw.id}/`;
          entities.push({
            remoteId: Number(raw.id) || 0,
            entityType: 'category',
            title: String(raw.name || 'Untitled Category').slice(0, 300),
            slug: slug.slice(0, 300),
            url: catUrl.slice(0, 500),
            status: 'publish',
            description: stripHtmlSummary(String(raw.description || '')),
            shortDescription: '',
            seoTitle: '',
            seoDescription: '',
            focusKeyword: '',
            seoPlugin: params.preferredPlugin,
            imagesCount: raw.image ? 1 : 0,
            missingAltCount:
              raw.image && !(raw.image as { alt?: string }).alt?.trim() ? 1 : 0,
          });
        }
      }
    } catch (err) {
      warnings.push(`Categories import warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (wpUsername && wpAppPassword) {
    const wpAuth = basicAuthHeader(wpUsername, wpAppPassword);
    for (const [ep, entityType] of [
      ['/wp-json/wp/v2/posts?per_page=20&context=edit', 'post'],
      ['/wp-json/wp/v2/pages?per_page=20&context=edit', 'page'],
    ] as const) {
      try {
        let res = await wpFetchJson(parsedUrl, ep, wpAuth);
        if (res.status === 401 || res.status === 403) {
          res = await wpFetchJson(parsedUrl, ep.replace('&context=edit', ''), wpAuth);
        }
        if (res.status >= 200 && res.status < 300 && Array.isArray(res.data)) {
          for (const raw of res.data as Array<Record<string, unknown>>) {
            const titleObj = raw.title as { raw?: string; rendered?: string } | undefined;
            const contentObj = raw.content as { raw?: string; rendered?: string } | undefined;
            const excerptObj = raw.excerpt as { raw?: string; rendered?: string } | undefined;
            const bodyHtml = String(contentObj?.raw || contentObj?.rendered || '');
            const imgs = countHtmlMissingAlts(bodyHtml);
            const seo = extractSeoMeta(raw, params.preferredPlugin);

            entities.push({
              remoteId: Number(raw.id) || 0,
              entityType,
              title: String(titleObj?.raw || titleObj?.rendered || 'Untitled').replace(/<[^>]+>/g, '').slice(0, 300),
              slug: String(raw.slug || '').slice(0, 300),
              url: String(raw.link || `${parsedUrl.origin}/?p=${raw.id}`).slice(0, 500),
              status: String(raw.status || 'publish').slice(0, 40),
              description: stripHtmlSummary(bodyHtml),
              shortDescription: stripHtmlSummary(
                String(excerptObj?.raw || excerptObj?.rendered || ''),
                5000
              ),
              seoTitle: seo.seoTitle,
              seoDescription: seo.seoDescription,
              focusKeyword: seo.focusKeyword,
              seoPlugin: seo.detected,
              imagesCount: imgs.total,
              missingAltCount: imgs.missing,
            });
          }
        } else {
          warnings.push(`WP ${entityType}s returned HTTP ${res.status}`);
        }
      } catch (err) {
        warnings.push(`WP ${entityType}s error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { entities, warnings };
}

export async function pushChangeToWordPress(params: {
  siteUrl: string;
  secrets: WpSecrets;
  seoPlugin: DetectedSeoPlugin;
  entityType: WpEntityType;
  remoteId: number;
  draft: {
    title?: string;
    description?: string;
    shortDescription?: string;
    seoTitle?: string;
    seoDescription?: string;
    focusKeyword?: string;
  };
}): Promise<{ updated: boolean; detail: string }> {
  const parsedUrl = await validatePublicHttpUrl(params.siteUrl);
  const { wpUsername, wpAppPassword, wcConsumerKey, wcConsumerSecret } = params.secrets;

  const metaEntries: Array<{ key: string; value: string }> = [];
  if (params.seoPlugin === 'rank_math') {
    if (params.draft.seoTitle !== undefined) metaEntries.push({ key: 'rank_math_title', value: params.draft.seoTitle });
    if (params.draft.seoDescription !== undefined) {
      metaEntries.push({ key: 'rank_math_description', value: params.draft.seoDescription });
    }
    if (params.draft.focusKeyword !== undefined) {
      metaEntries.push({ key: 'rank_math_focus_keyword', value: params.draft.focusKeyword });
    }
  } else if (params.seoPlugin === 'yoast') {
    if (params.draft.seoTitle !== undefined) metaEntries.push({ key: '_yoast_wpseo_title', value: params.draft.seoTitle });
    if (params.draft.seoDescription !== undefined) {
      metaEntries.push({ key: '_yoast_wpseo_metadesc', value: params.draft.seoDescription });
    }
    if (params.draft.focusKeyword !== undefined) {
      metaEntries.push({ key: '_yoast_wpseo_focuskw', value: params.draft.focusKeyword });
    }
  }

  if (params.entityType === 'product' || params.entityType === 'category') {
    if (!wcConsumerKey || !wcConsumerSecret) {
      throw new Error('WooCommerce Consumer Key and Secret are required to update products or categories.');
    }
    const wcAuth = basicAuthHeader(wcConsumerKey, wcConsumerSecret);
    if (params.entityType === 'product') {
      const payload: Record<string, unknown> = {};
      if (params.draft.title) payload.name = params.draft.title;
      if (params.draft.description !== undefined) payload.description = params.draft.description;
      if (params.draft.shortDescription !== undefined) {
        payload.short_description = params.draft.shortDescription;
      }
      if (metaEntries.length > 0) payload.meta_data = metaEntries;

      const res = await wpFetchJson(
        parsedUrl,
        `/wp-json/wc/v3/products/${params.remoteId}`,
        wcAuth,
        { method: 'PUT', body: payload }
      );
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`WooCommerce product update failed (HTTP ${res.status}): ${res.rawText.slice(0, 220)}`);
      }
      return {
        updated: true,
        detail: `Updated WooCommerce product #${params.remoteId}${metaEntries.length ? ` with ${params.seoPlugin} SEO meta` : ''}.`,
      };
    } else {
      const payload: Record<string, unknown> = {};
      if (params.draft.title) payload.name = params.draft.title;
      if (params.draft.description !== undefined) payload.description = params.draft.description;
      const res = await wpFetchJson(
        parsedUrl,
        `/wp-json/wc/v3/products/categories/${params.remoteId}`,
        wcAuth,
        { method: 'PUT', body: payload }
      );
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`WooCommerce category update failed (HTTP ${res.status}): ${res.rawText.slice(0, 200)}`);
      }
      return {
        updated: true,
        detail: `Updated WooCommerce category #${params.remoteId}.`,
      };
    }
  }

  // WordPress Post or Page
  if (!wpUsername || !wpAppPassword) {
    throw new Error('WordPress Application Password credentials are required to update posts or pages.');
  }
  const wpAuth = basicAuthHeader(wpUsername, wpAppPassword);
  const wpRoute = params.entityType === 'post' ? 'posts' : 'pages';
  const payload: Record<string, unknown> = {};
  if (params.draft.title) payload.title = params.draft.title;
  if (params.draft.description !== undefined) payload.content = params.draft.description;
  if (params.draft.shortDescription !== undefined) payload.excerpt = params.draft.shortDescription;
  if (metaEntries.length > 0) {
    payload.meta = Object.fromEntries(metaEntries.map((m) => [m.key, m.value]));
  }

  const res = await wpFetchJson(
    parsedUrl,
    `/wp-json/wp/v2/${wpRoute}/${params.remoteId}`,
    wpAuth,
    { method: 'POST', body: payload }
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`WordPress ${params.entityType} update failed (HTTP ${res.status}): ${res.rawText.slice(0, 220)}`);
  }

  return {
    updated: true,
    detail: `Updated WordPress ${params.entityType} #${params.remoteId}${metaEntries.length ? ` (attempted ${params.seoPlugin} meta fields)` : ''}.`,
  };
}
