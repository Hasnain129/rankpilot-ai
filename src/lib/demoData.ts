import {
  GeneratedContent,
  IntegrationConfig,
  KeywordProject,
  Lead,
  Order,
  Quote,
  SeoAudit,
  VisitorEvent,
  Website,
} from '../types';

const now = Date.now();
const daysAgo = (days: number) => ({ toMillis: () => now - days * 86400000 });

export const DEMO_WEBSITES: Website[] = [
  {
    id: 'demo_web_1',
    ownerId: 'demo_user',
    name: 'Northstar Cloud CRM',
    url: 'https://northstarcloud.example.com',
    domain: 'northstarcloud.example.com',
    industry: 'B2B SaaS',
    trackingId: 'rp_demo_northstar',
    seoScore: 88,
    pagesScanned: 18,
    status: 'active',
    lastScannedAt: new Date(now - 3600000 * 3).toISOString(),
    createdAt: daysAgo(45),
    updatedAt: daysAgo(0),
  },
  {
    id: 'demo_web_2',
    ownerId: 'demo_user',
    name: 'Harbor & Pine Goods',
    url: 'https://harborpine.example.com',
    domain: 'harborpine.example.com',
    industry: 'E-Commerce',
    trackingId: 'rp_demo_harbor',
    seoScore: 74,
    pagesScanned: 42,
    status: 'active',
    lastScannedAt: new Date(now - 86400000).toISOString(),
    createdAt: daysAgo(30),
    updatedAt: daysAgo(1),
  },
];

export const DEMO_AUDITS: SeoAudit[] = [
  {
    id: 'demo_audit_1',
    ownerId: 'demo_user',
    websiteId: 'demo_web_1',
    url: 'https://northstarcloud.example.com',
    score: 88,
    loadTimeMs: 420,
    httpStatus: 200,
    title: 'Northstar Cloud — B2B Revenue Operations & Pipeline Software',
    metaDescription: 'Unify customer pipelines, automate lead routing, and forecast quarterly ARR with Northstar Cloud CRM.',
    h1Count: 1,
    h2Count: 6,
    h3Count: 11,
    wordCount: 1240,
    totalImages: 14,
    missingAltCount: 1,
    internalLinks: 28,
    externalLinks: 4,
    brokenLinksCount: 0,
    brokenLinks: [],
    hasViewport: true,
    hasCanonical: true,
    hasOpenGraph: true,
    mobileFriendly: true,
    issues: [
      { severity: 'passed', category: 'Availability', title: 'HTTP 200 OK', detail: 'Page responded in 420 ms.' },
      { severity: 'passed', category: 'Meta Tags', title: 'Title tag length optimal', detail: '58 characters within 30–60 char sweet spot.' },
      { severity: 'passed', category: 'Headings', title: 'Single H1 structure', detail: 'Detected 1 H1, 6 H2, and 11 H3 headings.' },
      { severity: 'warning', category: 'Accessibility & Images', title: '1 of 14 images missing alt text', detail: 'Partner logo strip footer image lacks alt description.' },
    ],
    recommendations: [
      {
        priority: 'High',
        title: 'Add descriptive alt text to remaining brand partner image',
        impact: 'Improves WCAG accessibility compliance and image indexing',
        actionSteps: 'Update footer partner strip <img> tag with descriptive alt attribute.',
      },
      {
        priority: 'Medium',
        title: 'Add SoftwareApplication JSON-LD schema markup',
        impact: 'Enhances SERP rich snippet eligibility for SaaS comparisons',
        actionSteps: 'Embed structured JSON-LD in the homepage <head> with aggregateRating and pricing tiers.',
      },
    ],
    summary: 'Strong technical baseline (88/100) with fast server response and clean semantic hierarchy.',
    createdAt: daysAgo(0),
  },
];

export const DEMO_KEYWORDS: KeywordProject[] = [
  {
    id: 'demo_kw_1',
    ownerId: 'demo_user',
    websiteId: 'demo_web_1',
    seedKeyword: 'b2b revenue operations software',
    targetMarket: 'United States / English',
    relatedKeywords: [
      { keyword: 'revenue intelligence platform', intent: 'Commercial', competitionEstimate: 'High', rationale: 'Core category term for mid-market buyers.' },
      { keyword: 'pipeline forecasting software', intent: 'Commercial', competitionEstimate: 'Medium', rationale: 'High-intent pain point for VP of Sales.' },
      { keyword: 'revops automation tools', intent: 'Commercial', competitionEstimate: 'Medium', rationale: 'Strong fit for operations leads evaluating stack.' },
    ],
    longTailKeywords: [
      { keyword: 'best b2b revenue operations software for growing sales teams', intent: 'Commercial', funnelStage: 'BOFU' },
      { keyword: 'how to automate lead handoff between marketing and sales', intent: 'Informational', funnelStage: 'TOFU' },
    ],
    clusters: [
      { clusterName: 'Pipeline Forecasting', pillarTopic: 'Predictive Revenue Modeling', keywords: ['pipeline forecasting software', 'sales forecast accuracy metrics', 'weighted pipeline calculator'] },
      { clusterName: 'Lead Routing & Attribution', pillarTopic: 'Multi-Touch RevOps Attribution', keywords: ['revops automation tools', 'inbound lead routing rules', 'b2b attribution software'] },
    ],
    contentIdeas: [
      { title: 'The 2026 RevOps Tech Stack Blueprint for $5M–$50M ARR Teams', format: 'Pillar Guide', targetKeyword: 'b2b revenue operations software', angle: 'Consolidate fragmented tools into unified revenue attribution.' },
    ],
    suggestedTitles: [
      'B2B Revenue Operations Software: Complete Buyer Comparison',
      'How to Build Accurate Pipeline Forecasts Without Spreadsheets',
    ],
    createdAt: daysAgo(2),
  },
];

export const DEMO_CONTENT: GeneratedContent[] = [
  {
    id: 'demo_content_1',
    ownerId: 'demo_user',
    websiteId: 'demo_web_1',
    contentType: 'blog',
    title: 'How to Fix Lead Attribution Blind Spots in B2B SaaS',
    targetKeyword: 'b2b revenue attribution',
    metaTitle: 'Fix B2B Lead Attribution Blind Spots | Northstar Cloud',
    metaDescription: 'Learn how to connect organic search traffic directly to qualified quotes and closed revenue without spreadsheet guesswork.',
    body: '## Why First-Touch Analytics Alone Fall Short\n\nMost B2B teams track pageviews in one tool and quotes or closed deals in another. Without connecting visitor sessions to downstream quote acceptance, organic SEO efforts look disconnected from revenue.\n\n### 1. Capture UTM & Referrer Context at Entry\nPersist traffic source metadata across multi-page sessions before form submission.\n\n### 2. Track Quote-to-Order Velocity\nMeasure how quickly organic leads convert into accepted proposals.',
    status: 'published',
    createdAt: daysAgo(3),
    updatedAt: daysAgo(1),
  },
];

export const DEMO_VISITOR_EVENTS: VisitorEvent[] = [
  { id: 'de_1', ownerId: 'demo_user', websiteId: 'demo_web_1', trackingId: 'rp_demo_northstar', visitorId: 'v_101', sessionId: 's_101', eventType: 'pageview', path: '/pricing', referrer: 'https://google.com', trafficSource: 'Organic Search', deviceType: 'desktop', conversionValue: 0, createdAt: daysAgo(6) },
  { id: 'de_2', ownerId: 'demo_user', websiteId: 'demo_web_1', trackingId: 'rp_demo_northstar', visitorId: 'v_102', sessionId: 's_102', eventType: 'pageview', path: '/features/revops', referrer: 'https://google.com', trafficSource: 'Organic Search', deviceType: 'desktop', conversionValue: 0, createdAt: daysAgo(5) },
  { id: 'de_3', ownerId: 'demo_user', websiteId: 'demo_web_1', trackingId: 'rp_demo_northstar', visitorId: 'v_102', sessionId: 's_102', eventType: 'lead_submit', path: '/request-demo', referrer: 'https://google.com', trafficSource: 'Organic Search', deviceType: 'desktop', conversionValue: 4800, createdAt: daysAgo(5) },
  { id: 'de_4', ownerId: 'demo_user', websiteId: 'demo_web_1', trackingId: 'rp_demo_northstar', visitorId: 'v_103', sessionId: 's_103', eventType: 'pageview', path: '/', referrer: 'https://linkedin.com', trafficSource: 'Social', deviceType: 'mobile', conversionValue: 0, createdAt: daysAgo(4) },
  { id: 'de_5', ownerId: 'demo_user', websiteId: 'demo_web_1', trackingId: 'rp_demo_northstar', visitorId: 'v_104', sessionId: 's_104', eventType: 'pageview', path: '/blog/pipeline-forecasting', referrer: 'https://google.com', trafficSource: 'Organic Search', deviceType: 'desktop', conversionValue: 0, createdAt: daysAgo(3) },
  { id: 'de_6', ownerId: 'demo_user', websiteId: 'demo_web_2', trackingId: 'rp_demo_harbor', visitorId: 'v_201', sessionId: 's_201', eventType: 'pageview', path: '/collections/outdoor', referrer: '', trafficSource: 'Direct', deviceType: 'mobile', conversionValue: 0, createdAt: daysAgo(2) },
  { id: 'de_7', ownerId: 'demo_user', websiteId: 'demo_web_2', trackingId: 'rp_demo_harbor', visitorId: 'v_202', sessionId: 's_202', eventType: 'conversion', path: '/checkout/success', referrer: 'https://google.com', trafficSource: 'Paid Search', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'spring_sale', deviceType: 'desktop', conversionValue: 640, createdAt: daysAgo(1) },
  { id: 'de_8', ownerId: 'demo_user', websiteId: 'demo_web_1', trackingId: 'rp_demo_northstar', visitorId: 'v_105', sessionId: 's_105', eventType: 'quote_request', path: '/enterprise-quote', referrer: 'https://g2.com', trafficSource: 'Referral', deviceType: 'desktop', conversionValue: 12000, createdAt: daysAgo(0) },
];

export const DEMO_LEADS: Lead[] = [
  { id: 'dl_1', ownerId: 'demo_user', websiteId: 'demo_web_1', name: 'Claire Bennett', email: 'claire@meridianlogistics.io', phone: '+1 (415) 555-0142', company: 'Meridian Logistics', leadSource: 'Organic Search', status: 'Converted', estimatedValue: 4800, notes: 'Requested annual CRM seat quote after reading RevOps guide.', trackingSource: 'tracked', createdAt: daysAgo(5), updatedAt: daysAgo(2) },
  { id: 'dl_2', ownerId: 'demo_user', websiteId: 'demo_web_1', name: 'Marcus Vance', email: 'm.vance@ridgewaybio.com', phone: '+1 (617) 555-0188', company: 'Ridgeway Biotech', leadSource: 'Referral', status: 'Qualified', estimatedValue: 12000, notes: 'Enterprise team evaluating 40 seats.', trackingSource: 'tracked', createdAt: daysAgo(2), updatedAt: daysAgo(0) },
  { id: 'dl_3', ownerId: 'demo_user', websiteId: 'demo_web_2', name: 'Hannah Brooks', email: 'hannah@pacificoutfitter.com', phone: '+1 (206) 555-0119', company: 'Pacific Outfitter', leadSource: 'Website Form', status: 'Contacted', estimatedValue: 2200, notes: 'Wholesale catalog inquiry.', trackingSource: 'manual', createdAt: daysAgo(1), updatedAt: daysAgo(0) },
  { id: 'dl_4', ownerId: 'demo_user', websiteId: 'demo_web_1', name: 'Devon Patel', email: 'devon@kestrelpay.com', phone: '', company: 'Kestrel Pay', leadSource: 'Paid Search', status: 'New', estimatedValue: 6400, notes: 'Inbound demo request from comparison landing page.', trackingSource: 'tracked', createdAt: daysAgo(0), updatedAt: daysAgo(0) },
];

export const DEMO_QUOTES: Quote[] = [
  { id: 'dq_1', ownerId: 'demo_user', websiteId: 'demo_web_1', leadId: 'dl_1', customerName: 'Claire Bennett', customerEmail: 'claire@meridianlogistics.io', serviceOrProduct: 'Northstar Growth Plan (15 Seats Annual)', amount: 4800, currency: 'USD', status: 'Accepted', validUntil: '2026-12-01', notes: 'Signed MSA received.', createdAt: daysAgo(4), updatedAt: daysAgo(2) },
  { id: 'dq_2', ownerId: 'demo_user', websiteId: 'demo_web_1', leadId: 'dl_2', customerName: 'Marcus Vance', customerEmail: 'm.vance@ridgewaybio.com', serviceOrProduct: 'Northstar Enterprise (40 Seats + SSO)', amount: 12000, currency: 'USD', status: 'Sent', validUntil: '2026-12-15', notes: 'Pending security review.', createdAt: daysAgo(1), updatedAt: daysAgo(0) },
  { id: 'dq_3', ownerId: 'demo_user', websiteId: 'demo_web_2', leadId: 'dl_3', customerName: 'Hannah Brooks', customerEmail: 'hannah@pacificoutfitter.com', serviceOrProduct: 'Bulk Canvas Pack Order (50 Units)', amount: 2200, currency: 'USD', status: 'Pending', validUntil: '2026-12-10', notes: 'Confirming shipping pallet rates.', createdAt: daysAgo(0), updatedAt: daysAgo(0) },
];

export const DEMO_ORDERS: Order[] = [
  { id: 'do_1', ownerId: 'demo_user', websiteId: 'demo_web_1', orderNumber: 'ORD-2026-1041', customerName: 'Claire Bennett', customerEmail: 'claire@meridianlogistics.io', productOrService: 'Northstar Growth Plan (Annual)', amount: 4800, currency: 'USD', channel: 'Organic Search', entrySource: 'tracked_conversion', status: 'Completed', orderDate: '2026-11-12', createdAt: daysAgo(4), updatedAt: daysAgo(2) },
  { id: 'do_2', ownerId: 'demo_user', websiteId: 'demo_web_2', orderNumber: 'ORD-2026-1042', customerName: 'Lucas Meyer', customerEmail: 'lucas@meyerdesign.co', productOrService: 'Alpine Field Jacket + Pack Bundle', amount: 640, currency: 'USD', channel: 'Paid Search', entrySource: 'tracked_conversion', status: 'Completed', orderDate: '2026-11-15', createdAt: daysAgo(1), updatedAt: daysAgo(1) },
  { id: 'do_3', ownerId: 'demo_user', websiteId: 'demo_web_2', orderNumber: 'ORD-2026-1043', customerName: 'Westside Trail Co.', customerEmail: 'orders@westsidetrail.com', productOrService: 'Custom Retail Display Kit', amount: 1850, currency: 'USD', channel: 'Manual Entry', entrySource: 'manual_entry', status: 'Processing', orderDate: '2026-11-16', createdAt: daysAgo(0), updatedAt: daysAgo(0) },
];

export const DEMO_INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'di_1',
    ownerId: 'demo_user',
    websiteId: 'demo_web_1',
    provider: 'google_pagespeed',
    status: 'configured',
    identifier: 'https://northstarcloud.example.com',
    notes: 'Ready for Core Web Vitals checks.',
    createdAt: daysAgo(10),
    updatedAt: daysAgo(10),
  },
];
