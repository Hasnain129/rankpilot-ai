export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Converted' | 'Lost';
export type LeadSource =
  | 'Organic Search'
  | 'Direct'
  | 'Referral'
  | 'Paid Search'
  | 'Social'
  | 'Email'
  | 'Website Form';

export type QuoteStatus = 'Pending' | 'Sent' | 'Accepted' | 'Rejected';
export type OrderStatus = 'Pending' | 'Processing' | 'Completed' | 'Refunded';
export type OrderChannel =
  | 'Organic Search'
  | 'Direct'
  | 'Referral'
  | 'Paid Search'
  | 'Social'
  | 'Manual Entry'
  | 'Shopify'
  | 'WooCommerce';
export type OrderEntrySource =
  | 'tracked_conversion'
  | 'manual_entry'
  | 'shopify_sync'
  | 'woocommerce_sync';

export type ContentType =
  | 'blog'
  | 'meta_title'
  | 'meta_description'
  | 'product_description'
  | 'landing_page'
  | 'faq';

export type IntegrationProvider =
  | 'google_search_console'
  | 'google_analytics_4'
  | 'google_pagespeed'
  | 'shopify'
  | 'woocommerce';

export type NavSection =
  | 'dashboard'
  | 'websites'
  | 'seo-analyzer'
  | 'keyword-research'
  | 'content-studio'
  | 'visitor-tracking'
  | 'leads'
  | 'quotes'
  | 'orders'
  | 'sales-analytics'
  | 'integrations'
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
  issues: SeoIssue[];
  recommendations: SeoRecommendation[];
  summary: string;
  createdAt?: unknown;
}

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

export interface KeywordCluster {
  clusterName: string;
  pillarTopic: string;
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
  relatedKeywords: RelatedKeyword[];
  longTailKeywords: LongTailKeyword[];
  clusters: KeywordCluster[];
  contentIdeas: ContentIdea[];
  suggestedTitles: string[];
  createdAt?: unknown;
}

export interface GeneratedContent {
  id: string;
  ownerId: string;
  websiteId?: string;
  contentType: ContentType;
  title: string;
  targetKeyword?: string;
  body: string;
  metaTitle?: string;
  metaDescription?: string;
  status: 'draft' | 'published';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface VisitorEvent {
  id: string;
  ownerId: string;
  websiteId: string;
  trackingId: string;
  visitorId: string;
  sessionId: string;
  eventType: 'pageview' | 'conversion' | 'lead_submit' | 'quote_request';
  path: string;
  referrer?: string;
  trafficSource: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  conversionValue: number;
  createdAt?: unknown;
}

export interface Lead {
  id: string;
  ownerId: string;
  websiteId: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  leadSource: LeadSource;
  status: LeadStatus;
  estimatedValue: number;
  notes?: string;
  trackingSource: 'tracked' | 'manual';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Quote {
  id: string;
  ownerId: string;
  websiteId: string;
  leadId?: string;
  customerName: string;
  customerEmail: string;
  serviceOrProduct: string;
  amount: number;
  currency: string;
  status: QuoteStatus;
  validUntil?: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Order {
  id: string;
  ownerId: string;
  websiteId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  productOrService: string;
  amount: number;
  currency: string;
  channel: OrderChannel;
  entrySource: OrderEntrySource;
  status: OrderStatus;
  orderDate: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface IntegrationConfig {
  id: string;
  ownerId: string;
  websiteId: string;
  provider: IntegrationProvider;
  status: 'not_connected' | 'configured';
  identifier?: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
