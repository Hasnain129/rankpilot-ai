export type NavSection =
  | 'dashboard'
  | 'website-audit'
  | 'keyword-research'
  | 'rank-tracker'
  | 'on-page-seo'
  | 'technical-seo'
  | 'ai-recommendations'
  | 'seo-reports'
  | 'websites'
  | 'search-console'
  | 'ga4-integration'
  | 'profile';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  companyName?: string;
  role: 'member';
  plan: 'free';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Website {
  id: string;
  ownerId: string;
  name: string;
  url: string;
  domain: string;
  industry?: string;
  trackingId: string;
  seoScore: number;
  pagesScanned: number;
  status: 'active' | 'paused';
  lastScannedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SeoIssue {
  severity: 'critical' | 'warning' | 'passed';
  category: string;
  title: string;
  detail: string;
}

export interface SeoRecommendation {
  priority: string;
  title: string;
  impact: string;
  actionSteps: string;
}

export interface SeoAudit {
  id: string;
  ownerId: string;
  websiteId: string;
  url: string;
  score: number;
  loadTimeMs: number;
  httpStatus: number;
  title: string;
  metaDescription: string;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  wordCount: number;
  totalImages: number;
  missingAltCount: number;
  internalLinks: number;
  externalLinks: number;
  brokenLinksCount: number;
  brokenLinks?: string[];
  hasViewport: boolean;
  hasCanonical: boolean;
  hasOpenGraph: boolean;
  mobileFriendly: boolean;
  redirectChain?: string[];
  redirectCount?: number;
  metaRobots?: string;
  xRobotsTag?: string;
  issues: SeoIssue[];
  recommendations: SeoRecommendation[];
  summary: string;
  createdAt?: unknown;
}

export type CrawledPageType = 'product' | 'category' | 'blog' | 'landing' | 'other';

export interface CrawledPageSummary {
  url: string;
  pageType: CrawledPageType;
  httpStatus: number;
  loadTimeMs: number;
  title: string;
  metaDescription: string;
  h1: string;
  h1Count: number;
  h2Count?: number;
  canonicalUrl: string;
  noindex: boolean;
  redirectChain?: string[];
  redirectCount?: number;
  metaRobots?: string;
  xRobotsTag?: string;
  wordCount: number;
  missingAltCount: number;
  brokenLinksCount: number;
  schemaTypes: string[];
  score: number;
  issuesCount: number;
}

export interface SiteCrawl {
  id: string;
  ownerId: string;
  websiteId: string;
  rootUrl: string;
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
  pages: CrawledPageSummary[];
  siteIssues: Array<{
    severity: 'critical' | 'warning' | 'passed';
    category: string;
    title: string;
    detail: string;
    affectedCount: number;
  }>;
  summary: string;
  createdAt?: unknown;
}

export type KeywordCategory = 'related' | 'long_tail' | 'question' | 'commercial' | 'synonym';

export interface RelatedKeyword {
  keyword: string;
  intent: string;
  competitionEstimate: string;
  rationale: string;
}

export interface LongTailKeyword {
  keyword: string;
  intent: string;
  funnelStage: string;
}

export interface KeywordMetricItem {
  keyword: string;
  category: KeywordCategory;
  intent: string;
  country: string;
  language: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  competition: string | null;
  competitionEstimate: string;
  opportunityScore: number | null;
  opportunityTier: string;
  funnelStage?: string;
  rationale: string;
  dataSource: 'google_ads' | 'dataforseo' | 'ai_estimate';
}

export interface KeywordOpportunityItem {
  keyword: string;
  bucket: 'low_competition_candidate' | 'commercial_buying' | 'ecommerce_priority' | 'informational_blog';
  intent: string;
  whyItWins: string;
  recommendedAssetType: string;
  isVerifiedMetric: boolean;
}

export interface KeywordAssignment {
  keyword: string;
  targetUrl: string;
  pageTitle: string;
  entityType: string;
  assignedAt: string;
}

export interface KeywordCluster {
  clusterName: string;
  pillarTopic: string;
  recommendedPrimaryKeyword?: string;
  suggestedAssetType?: string;
  cannibalizationRisk?: string;
  keywords: string[];
}

export interface ContentIdea {
  title: string;
  format: string;
  targetKeyword: string;
  angle: string;
}

export interface KeywordProject {
  id: string;
  ownerId: string;
  websiteId?: string;
  seedKeyword: string;
  targetMarket?: string;
  country?: string;
  language?: string;
  sourceType?: 'keyword' | 'product' | 'url' | 'category';
  targetUrl?: string;
  relatedKeywords: RelatedKeyword[];
  longTailKeywords: LongTailKeyword[];
  keywordItems?: KeywordMetricItem[];
  synonyms?: string[];
  opportunities?: KeywordOpportunityItem[];
  assignments?: KeywordAssignment[];
  dataNotice?: string;
  clusters: KeywordCluster[];
  contentIdeas: ContentIdea[];
  suggestedTitles: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface KeywordMappingResult {
  mappings: Array<{
    url: string;
    pageType: string;
    primaryKeyword: string;
    longTailKeywords: string[];
    searchIntent: string;
    competitionEstimate: string;
    opportunityNote: string;
  }>;
  cannibalizationAlerts: Array<{
    competingTopic: string;
    urls: string[];
    severity: string;
    resolutionAdvice: string;
  }>;
  dataNotice: string;
}

export interface CompetitorKeywordAnalysisResult {
  crawledPages: Array<{
    url: string;
    title: string;
    metaDescription: string;
    h1: string;
    wordCount: number;
    error?: string;
  }>;
  discoveredKeywords: Array<{
    keyword: string;
    intent: string;
    foundOnUrl: string;
    opportunityType: string;
    recommendedTargetAsset: string;
    rationale: string;
  }>;
  contentGaps: Array<{
    topic: string;
    competitorAngle: string;
    suggestedTitle: string;
    targetKeyword: string;
  }>;
  dataNotice: string;
}

export interface KeywordProviderStatus {
  id: 'gemini_ai' | 'google_search_console' | 'google_ads' | 'dataforseo' | 'serp_api';
  name: string;
  connected: boolean;
  capability: string;
  pricingTier: string;
  missingEnvVars: string[];
  note: string;
}

export interface WpConnection {
  id: string;
  ownerId: string;
  websiteId: string;
  siteUrl: string;
  wpUsername?: string;
  seoPlugin: 'rank_math' | 'yoast' | 'none';
  hasWpAppPassword: boolean;
  hasWcKeys: boolean;
  status: 'connected' | 'error' | 'disconnected';
  lastSyncAt?: string;
  syncMessage?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WpEntity {
  id: string;
  ownerId: string;
  websiteId: string;
  remoteId: number;
  entityType: 'product' | 'category' | 'page' | 'post';
  title: string;
  slug?: string;
  url: string;
  status?: string;
  description?: string;
  shortDescription?: string;
  seoTitle?: string;
  seoDescription?: string;
  focusKeyword?: string;
  seoPlugin: 'rank_math' | 'yoast' | 'none';
  imagesCount: number;
  missingAltCount: number;
  lastImportedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface OptimizationDraftFields {
  title?: string;
  seoTitle?: string;
  seoDescription?: string;
  shortDescription?: string;
  description?: string;
  headingSuggestions?: string[];
  imageAltSuggestions?: string[];
}

export interface SeoOptimization {
  id: string;
  ownerId: string;
  websiteId: string;
  entityId?: string;
  remoteId: number;
  entityType: 'product' | 'category' | 'page' | 'post' | 'url';
  targetUrl: string;
  targetKeyword?: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'applied' | 'rolled_back';
  originalSnapshot: OptimizationDraftFields & { focusKeyword?: string };
  optimizedDraft: OptimizationDraftFields;
  internalLinksSuggested: Array<{ anchorText: string; targetUrl: string; reason: string }>;
  faqSchemaJson?: string;
  aiNotes?: string;
  verifiedScore?: number;
  appliedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GscSnapshot {
  id: string;
  ownerId: string;
  websiteId: string;
  propertyUrl: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  prevClicks: number;
  prevImpressions: number;
  dailySeries: Array<{
    date: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  topQueries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  topPages: Array<{
    page: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    positionDelta?: number;
  }>;
  topCountries?: Array<{
    country: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  topDevices?: Array<{
    device: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  createdAt?: unknown;
}

export interface TrackedKeyword {
  id: string;
  ownerId: string;
  websiteId: string;
  keyword: string;
  targetUrl?: string;
  country: string;
  language: string;
  device: 'desktop' | 'mobile';
  currentPosition: number;
  previousPosition: number;
  bestPosition: number;
  sourceType: 'gsc_verified' | 'serp_api' | 'unverified';
  clicks: number;
  impressions: number;
  history: Array<{ date: string; position: number; source: string }>;
  lastCheckedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TechnicalSnapshot {
  id: string;
  ownerId: string;
  websiteId: string;
  url: string;
  strategy: 'mobile' | 'desktop';
  performanceScore: number;
  seoScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  lcpMs: number;
  cls: number;
  inpMs: number;
  fcpMs: number;
  ttfbMs: number;
  robotsStatus?: string;
  sitemapStatus?: string;
  opportunities: Array<{ title: string; savings: string; description: string }>;
  createdAt?: unknown;
}

export interface SyncLog {
  id: string;
  ownerId: string;
  websiteId: string;
  channel:
    | 'wordpress'
    | 'woocommerce'
    | 'gsc'
    | 'ga4'
    | 'rank_tracker'
    | 'crawler'
    | 'pagespeed'
    | 'recommendations';
  action: string;
  status: 'success' | 'error' | 'warning';
  detail: string;
  createdAt?: unknown;
}

export type RecommendationCategory =
  | 'technical'
  | 'on_page'
  | 'keyword'
  | 'content'
  | 'internal_linking';

export type RecommendationPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type RecommendationStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';

export interface AiSeoRecommendation {
  id: string;
  ownerId: string;
  websiteId: string;
  category: RecommendationCategory;
  priority: RecommendationPriority;
  status: RecommendationStatus;
  affectedPage: string;
  whatIsWrong: string;
  whyItMatters: string;
  howToFix: string;
  expectedBenefit: string;
  sourceBasis: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AnalyticsSnapshot {
  id: string;
  ownerId: string;
  websiteId: string;
  propertyId: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  totalUsers: number;
  newUsers: number;
  returningUsers: number;
  sessions: number;
  organicSessions: number;
  directSessions: number;
  referralSessions: number;
  campaignSessions: number;
  conversions: number;
  conversionRate: number;
  purchaseRevenue: number;
  hasVerifiedRevenue: boolean;
  trafficSources: Array<{
    channel: string;
    sessions: number;
    users: number;
    conversions: number;
  }>;
  topLandingPages: Array<{
    page: string;
    sessions: number;
    users: number;
    conversions: number;
    revenue: number;
  }>;
  campaignPerformance: Array<{
    campaign: string;
    sourceMedium: string;
    sessions: number;
    conversions: number;
    revenue: number;
  }>;
  dailySeries: Array<{
    date: string;
    sessions: number;
    conversions: number;
    revenue: number;
  }>;
  createdAt?: unknown;
}
