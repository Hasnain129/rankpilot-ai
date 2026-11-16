import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import {
  DEMO_AUDITS,
  DEMO_CONTENT,
  DEMO_GSC_SNAPSHOTS,
  DEMO_INTEGRATIONS,
  DEMO_KEYWORDS,
  DEMO_LEADS,
  DEMO_OPTIMIZATIONS,
  DEMO_ORDERS,
  DEMO_QUOTES,
  DEMO_SITE_CRAWLS,
  DEMO_SYNC_LOGS,
  DEMO_TECHNICAL_SNAPSHOTS,
  DEMO_TRACKED_KEYWORDS,
  DEMO_VISITOR_EVENTS,
  DEMO_WEBSITES,
  DEMO_WP_CONNECTIONS,
  DEMO_WP_ENTITIES,
} from '../lib/demoData';
import { OperationType, db, handleFirestoreError } from '../lib/firebase';
import {
  ContentType,
  GeneratedContent,
  GscSnapshot,
  IntegrationConfig,
  IntegrationProvider,
  KeywordProject,
  Lead,
  LeadSource,
  LeadStatus,
  OptimizationDraftFields,
  Order,
  OrderChannel,
  OrderEntrySource,
  OrderStatus,
  Quote,
  QuoteStatus,
  SeoAudit,
  SeoOptimization,
  SiteCrawl,
  SyncLog,
  TechnicalSnapshot,
  TrackedKeyword,
  VisitorEvent,
  Website,
  WpConnection,
  WpEntity,
} from '../types';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (
    typeof val === 'object' &&
    val !== null &&
    'toMillis' in val &&
    typeof (val as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') return Date.parse(val) || 0;
  return 0;
}

function sortDesc<T extends { createdAt?: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
}

export function useWorkspaceData() {
  const { user, authReady, isDemoMode } = useAuth();

  const [websites, setWebsites] = useState<Website[]>([]);
  const [seoAudits, setSeoAudits] = useState<SeoAudit[]>([]);
  const [siteCrawls, setSiteCrawls] = useState<SiteCrawl[]>([]);
  const [wpConnections, setWpConnections] = useState<WpConnection[]>([]);
  const [wpEntities, setWpEntities] = useState<WpEntity[]>([]);
  const [seoOptimizations, setSeoOptimizations] = useState<SeoOptimization[]>([]);
  const [gscSnapshots, setGscSnapshots] = useState<GscSnapshot[]>([]);
  const [trackedKeywords, setTrackedKeywords] = useState<TrackedKeyword[]>([]);
  const [technicalSnapshots, setTechnicalSnapshots] = useState<TechnicalSnapshot[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [keywordProjects, setKeywordProjects] = useState<KeywordProject[]>([]);
  const [generatedContents, setGeneratedContents] = useState<GeneratedContent[]>([]);
  const [visitorEvents, setVisitorEvents] = useState<VisitorEvent[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemoMode) {
      setWebsites(DEMO_WEBSITES);
      setSeoAudits(DEMO_AUDITS);
      setSiteCrawls(DEMO_SITE_CRAWLS);
      setWpConnections(DEMO_WP_CONNECTIONS);
      setWpEntities(DEMO_WP_ENTITIES);
      setSeoOptimizations(DEMO_OPTIMIZATIONS);
      setGscSnapshots(DEMO_GSC_SNAPSHOTS);
      setTrackedKeywords(DEMO_TRACKED_KEYWORDS);
      setTechnicalSnapshots(DEMO_TECHNICAL_SNAPSHOTS);
      setSyncLogs(DEMO_SYNC_LOGS);
      setKeywordProjects(DEMO_KEYWORDS);
      setGeneratedContents(DEMO_CONTENT);
      setVisitorEvents(DEMO_VISITOR_EVENTS);
      setLeads(DEMO_LEADS);
      setQuotes(DEMO_QUOTES);
      setOrders(DEMO_ORDERS);
      setIntegrations(DEMO_INTEGRATIONS);
      setLoading(false);
      setError(null);
      return;
    }

    if (!authReady) return;
    if (!user) {
      setWebsites([]);
      setSeoAudits([]);
      setSiteCrawls([]);
      setWpConnections([]);
      setWpEntities([]);
      setSeoOptimizations([]);
      setGscSnapshots([]);
      setTrackedKeywords([]);
      setTechnicalSnapshots([]);
      setSyncLogs([]);
      setKeywordProjects([]);
      setGeneratedContents([]);
      setVisitorEvents([]);
      setLeads([]);
      setQuotes([]);
      setOrders([]);
      setIntegrations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const uid = user.uid;
    let settledCount = 0;
    const totalListeners = 17;
    const markSettled = () => {
      settledCount++;
      if (settledCount >= totalListeners) setLoading(false);
    };

    const listen = <T extends { id?: string; createdAt?: unknown }>(
      colName: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      transform?: (raw: Record<string, unknown>, id: string) => T
    ) =>
      onSnapshot(
        query(collection(db, colName), where('ownerId', '==', uid)),
        (snap) => {
          const items = snap.docs.map((d) =>
            transform ? transform(d.data(), d.id) : ({ id: d.id, ...d.data() } as T)
          );
          setter(sortDesc(items));
          markSettled();
        },
        (err) => {
          setError(err.message);
          markSettled();
          handleFirestoreError(err, OperationType.LIST, colName);
        }
      );

    const unsubs = [
      listen<Website>('websites', setWebsites),
      listen<SeoAudit>('seoAudits', setSeoAudits),
      listen<SiteCrawl>('siteCrawls', setSiteCrawls),
      listen<WpConnection>('wpConnections', setWpConnections, (raw, id) => {
        // Never retain encryptedSecrets ciphertext inside React state
        const { encryptedSecrets: _stripped, ...rest } = raw;
        return { id, ...rest } as WpConnection;
      }),
      listen<WpEntity>('wpEntities', setWpEntities),
      listen<SeoOptimization>('seoOptimizations', setSeoOptimizations),
      listen<GscSnapshot>('gscSnapshots', setGscSnapshots),
      listen<TrackedKeyword>('trackedKeywords', setTrackedKeywords),
      listen<TechnicalSnapshot>('technicalSnapshots', setTechnicalSnapshots),
      listen<SyncLog>('syncLogs', setSyncLogs),
      listen<KeywordProject>('keywordProjects', setKeywordProjects),
      listen<GeneratedContent>('generatedContents', setGeneratedContents),
      listen<VisitorEvent>('visitorEvents', setVisitorEvents),
      listen<Lead>('leads', setLeads),
      listen<Quote>('quotes', setQuotes),
      listen<Order>('orders', setOrders),
      listen<IntegrationConfig>('integrations', setIntegrations),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [user, authReady, isDemoMode]);

  const ensureWriteAllowed = useCallback(() => {
    if (isDemoMode) return 'demo_user';
    if (!user) throw new Error('Please sign in to save changes.');
    if (!user.emailVerified) {
      throw new Error('Please verify your email address before saving data to Firestore.');
    }
    return user.uid;
  }, [isDemoMode, user]);

  // Websites
  const addWebsite = useCallback(
    async (input: { name: string; url: string; industry?: string }): Promise<Website> => {
      const uid = ensureWriteAllowed();
      const rawUrl = input.url.trim().match(/^https?:\/\//i) ? input.url.trim() : `https://${input.url.trim()}`;
      const parsed = new URL(rawUrl);
      const websiteId = makeId('web');
      const trackingId = `rp_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

      const websitePayload = {
        ownerId: uid,
        name: input.name.trim().slice(0, 120) || parsed.hostname,
        url: parsed.toString().slice(0, 500),
        domain: parsed.hostname.slice(0, 253),
        industry: (input.industry || '').trim().slice(0, 80),
        trackingId,
        seoScore: 0,
        pagesScanned: 0,
        status: 'active' as const,
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
        updatedAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };

      if (isDemoMode) {
        const created: Website = { id: websiteId, ...websitePayload };
        setWebsites((prev) => [created, ...prev]);
        return created;
      }

      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'websites', websiteId), websitePayload);
        batch.set(doc(db, 'trackingKeys', trackingId), {
          trackingId,
          websiteId,
          ownerId: uid,
          domain: parsed.hostname.slice(0, 253),
          createdAt: serverTimestamp(),
        });
        await batch.commit();
        return { id: websiteId, ...websitePayload };
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `websites/${websiteId}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const updateWebsite = useCallback(
    async (
      website: Website,
      updates: { name?: string; url?: string; industry?: string; status?: 'active' | 'paused' }
    ) => {
      ensureWriteAllowed();
      const cleanPayload: Record<string, unknown> = {};
      if (updates.name !== undefined) cleanPayload.name = updates.name.trim().slice(0, 120) || website.name;
      if (updates.industry !== undefined) cleanPayload.industry = updates.industry.trim().slice(0, 80);
      if (updates.status !== undefined) cleanPayload.status = updates.status;
      let nextDomain: string | undefined;
      if (updates.url !== undefined) {
        const rawUrl = updates.url.trim().match(/^https?:\/\//i)
          ? updates.url.trim()
          : `https://${updates.url.trim()}`;
        const parsed = new URL(rawUrl);
        cleanPayload.url = parsed.toString().slice(0, 500);
        nextDomain = parsed.hostname.slice(0, 253);
        cleanPayload.domain = nextDomain;
      }

      if (isDemoMode) {
        setWebsites((prev) => prev.map((w) => (w.id === website.id ? { ...w, ...cleanPayload } : w)));
        return;
      }

      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'websites', website.id), { ...cleanPayload, updatedAt: serverTimestamp() });
        if (nextDomain && nextDomain !== website.domain && website.trackingId) {
          batch.update(doc(db, 'trackingKeys', website.trackingId), { domain: nextDomain });
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `websites/${website.id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const deleteWebsite = useCallback(
    async (website: Website) => {
      ensureWriteAllowed();
      if (isDemoMode) {
        setWebsites((prev) => prev.filter((w) => w.id !== website.id));
        return;
      }
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'websites', website.id));
        if (website.trackingId) batch.delete(doc(db, 'trackingKeys', website.trackingId));
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `websites/${website.id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  // SEO Audits
  const saveSeoAudit = useCallback(
    async (websiteId: string, audit: Omit<SeoAudit, 'id' | 'ownerId' | 'websiteId' | 'createdAt'>) => {
      const uid = ensureWriteAllowed();
      const auditId = makeId('aud');
      const payload = {
        ownerId: uid,
        websiteId,
        url: audit.url.slice(0, 500),
        score: Math.round(Math.max(0, Math.min(100, audit.score))),
        loadTimeMs: Math.round(Math.max(0, Math.min(120000, audit.loadTimeMs))),
        httpStatus: Math.round(Math.max(0, Math.min(599, audit.httpStatus))),
        title: (audit.title || '').slice(0, 300),
        metaDescription: (audit.metaDescription || '').slice(0, 600),
        h1Count: Math.round(audit.h1Count || 0),
        h2Count: Math.round(audit.h2Count || 0),
        h3Count: Math.round(audit.h3Count || 0),
        wordCount: Math.round(audit.wordCount || 0),
        totalImages: Math.round(audit.totalImages || 0),
        missingAltCount: Math.round(audit.missingAltCount || 0),
        internalLinks: Math.round(audit.internalLinks || 0),
        externalLinks: Math.round(audit.externalLinks || 0),
        brokenLinksCount: Math.round(audit.brokenLinksCount || 0),
        brokenLinks: (audit.brokenLinks || []).slice(0, 20),
        hasViewport: Boolean(audit.hasViewport),
        hasCanonical: Boolean(audit.hasCanonical),
        hasOpenGraph: Boolean(audit.hasOpenGraph),
        mobileFriendly: Boolean(audit.mobileFriendly),
        issues: (audit.issues || []).slice(0, 30),
        recommendations: (audit.recommendations || []).slice(0, 20),
        summary: (audit.summary || '').slice(0, 2000),
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };

      if (isDemoMode) {
        setSeoAudits((prev) => [{ id: auditId, ...payload }, ...prev]);
        setWebsites((prev) =>
          prev.map((w) =>
            w.id === websiteId
              ? { ...w, seoScore: payload.score, pagesScanned: w.pagesScanned + 1, lastScannedAt: new Date().toISOString() }
              : w
          )
        );
        return;
      }

      const existingWeb = websites.find((w) => w.id === websiteId);
      const nextPages = (existingWeb?.pagesScanned || 0) + 1;
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'seoAudits', auditId), payload);
        batch.update(doc(db, 'websites', websiteId), {
          seoScore: payload.score,
          pagesScanned: nextPages,
          lastScannedAt: new Date().toISOString().slice(0, 64),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `seoAudits/${auditId}`);
      }
    },
    [ensureWriteAllowed, isDemoMode, websites]
  );

  // SEO Optimization Center CRUD (Phase 3)
  const createOptimization = useCallback(
    async (input: {
      websiteId: string;
      entityId?: string;
      remoteId: number;
      entityType: 'product' | 'category' | 'page' | 'post' | 'url';
      targetUrl: string;
      targetKeyword?: string;
      originalSnapshot: OptimizationDraftFields & { focusKeyword?: string };
      optimizedDraft: OptimizationDraftFields;
      internalLinksSuggested: Array<{ anchorText: string; targetUrl: string; reason: string }>;
      faqSchemaJson?: string;
      aiNotes?: string;
    }): Promise<string> => {
      const uid = ensureWriteAllowed();
      const id = makeId('opt');
      const payload = {
        ownerId: uid,
        websiteId: input.websiteId,
        entityId: (input.entityId || '').slice(0, 128),
        remoteId: Math.trunc(Math.max(0, Number(input.remoteId) || 0)),
        entityType: input.entityType,
        targetUrl: input.targetUrl.slice(0, 500),
        targetKeyword: (input.targetKeyword || '').slice(0, 200),
        status: 'pending_review' as const,
        originalSnapshot: input.originalSnapshot,
        optimizedDraft: input.optimizedDraft,
        internalLinksSuggested: (input.internalLinksSuggested || []).slice(0, 10),
        faqSchemaJson: (input.faqSchemaJson || '').slice(0, 12000),
        aiNotes: (input.aiNotes || '').slice(0, 2000),
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
        updatedAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };

      if (isDemoMode) {
        setSeoOptimizations((prev) => [{ id, ...payload }, ...prev]);
        return id;
      }

      try {
        await setDoc(doc(db, 'seoOptimizations', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `seoOptimizations/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const updateOptimizationDraft = useCallback(
    async (
      id: string,
      updates: {
        status?: 'pending_review' | 'approved' | 'rejected';
        optimizedDraft?: OptimizationDraftFields;
        targetKeyword?: string;
        faqSchemaJson?: string;
        aiNotes?: string;
      }
    ) => {
      ensureWriteAllowed();
      const clean: Record<string, unknown> = {};
      if (updates.status !== undefined) clean.status = updates.status;
      if (updates.optimizedDraft !== undefined) clean.optimizedDraft = updates.optimizedDraft;
      if (updates.targetKeyword !== undefined) clean.targetKeyword = updates.targetKeyword.slice(0, 200);
      if (updates.faqSchemaJson !== undefined) clean.faqSchemaJson = updates.faqSchemaJson.slice(0, 12000);
      if (updates.aiNotes !== undefined) clean.aiNotes = updates.aiNotes.slice(0, 2000);

      if (isDemoMode) {
        setSeoOptimizations((prev) => prev.map((o) => (o.id === id ? { ...o, ...clean } : o)));
        return;
      }
      try {
        await updateDoc(doc(db, 'seoOptimizations', id), {
          ...clean,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `seoOptimizations/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const deleteOptimization = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      if (isDemoMode) {
        setSeoOptimizations((prev) => prev.filter((o) => o.id !== id));
        return;
      }
      try {
        await deleteDoc(doc(db, 'seoOptimizations', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `seoOptimizations/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  // Tracked Keywords (Phase 6)
  const addTrackedKeyword = useCallback(
    async (input: {
      websiteId: string;
      keyword: string;
      targetUrl?: string;
      country: string;
      language: string;
      device: 'desktop' | 'mobile';
    }): Promise<string> => {
      const uid = ensureWriteAllowed();
      const id = makeId('tkw');
      const payload = {
        ownerId: uid,
        websiteId: input.websiteId,
        keyword: input.keyword.trim().slice(0, 200),
        targetUrl: (input.targetUrl || '').trim().slice(0, 500),
        country: (input.country || 'US').trim().slice(0, 16),
        language: (input.language || 'en').trim().slice(0, 16),
        device: input.device,
        currentPosition: 0,
        previousPosition: 0,
        bestPosition: 0,
        sourceType: 'unverified' as const,
        clicks: 0,
        impressions: 0,
        history: [],
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
        updatedAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };
      if (isDemoMode) {
        setTrackedKeywords((prev) => [{ id, ...payload }, ...prev]);
        return id;
      }
      try {
        await setDoc(doc(db, 'trackedKeywords', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `trackedKeywords/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const deleteTrackedKeyword = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      if (isDemoMode) {
        setTrackedKeywords((prev) => prev.filter((k) => k.id !== id));
        return;
      }
      try {
        await deleteDoc(doc(db, 'trackedKeywords', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `trackedKeywords/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  // Keyword Research
  const saveKeywordProject = useCallback(
    async (project: Omit<KeywordProject, 'id' | 'ownerId' | 'createdAt'>) => {
      const uid = ensureWriteAllowed();
      const id = makeId('kw');
      const payload = {
        ownerId: uid,
        websiteId: (project.websiteId || 'all').slice(0, 128),
        seedKeyword: project.seedKeyword.slice(0, 160),
        targetMarket: (project.targetMarket || 'Global').slice(0, 80),
        relatedKeywords: (project.relatedKeywords || []).slice(0, 25),
        longTailKeywords: (project.longTailKeywords || []).slice(0, 25),
        clusters: (project.clusters || []).slice(0, 15),
        contentIdeas: (project.contentIdeas || []).slice(0, 15),
        suggestedTitles: (project.suggestedTitles || []).slice(0, 15),
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };
      if (isDemoMode) {
        setKeywordProjects((prev) => [{ id, ...payload }, ...prev]);
        return;
      }
      try {
        await setDoc(doc(db, 'keywordProjects', id), payload);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `keywordProjects/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const deleteKeywordProject = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      if (isDemoMode) {
        setKeywordProjects((prev) => prev.filter((k) => k.id !== id));
        return;
      }
      try {
        await deleteDoc(doc(db, 'keywordProjects', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `keywordProjects/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  // Generated Content
  const saveGeneratedContent = useCallback(
    async (input: {
      websiteId?: string;
      contentType: ContentType;
      title: string;
      targetKeyword?: string;
      body: string;
      metaTitle?: string;
      metaDescription?: string;
      status: 'draft' | 'published';
    }): Promise<string> => {
      const uid = ensureWriteAllowed();
      const id = makeId('cnt');
      const payload = {
        ownerId: uid,
        websiteId: (input.websiteId || 'all').slice(0, 128),
        contentType: input.contentType,
        title: input.title.trim().slice(0, 240) || 'Untitled Asset',
        targetKeyword: (input.targetKeyword || '').trim().slice(0, 160),
        body: input.body.slice(0, 25000),
        metaTitle: (input.metaTitle || '').slice(0, 160),
        metaDescription: (input.metaDescription || '').slice(0, 320),
        status: input.status,
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
        updatedAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };
      if (isDemoMode) {
        setGeneratedContents((prev) => [{ id, ...payload }, ...prev]);
        return id;
      }
      try {
        await setDoc(doc(db, 'generatedContents', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `generatedContents/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const updateGeneratedContent = useCallback(
    async (
      id: string,
      updates: {
        title?: string;
        targetKeyword?: string;
        body?: string;
        metaTitle?: string;
        metaDescription?: string;
        status?: 'draft' | 'published';
      }
    ) => {
      ensureWriteAllowed();
      const cleanUpdates: Record<string, unknown> = {};
      if (updates.title !== undefined) cleanUpdates.title = updates.title.trim().slice(0, 240) || 'Untitled Asset';
      if (updates.targetKeyword !== undefined) cleanUpdates.targetKeyword = updates.targetKeyword.trim().slice(0, 160);
      if (updates.body !== undefined) cleanUpdates.body = updates.body.slice(0, 25000) || ' ';
      if (updates.metaTitle !== undefined) cleanUpdates.metaTitle = updates.metaTitle.slice(0, 160);
      if (updates.metaDescription !== undefined) cleanUpdates.metaDescription = updates.metaDescription.slice(0, 320);
      if (updates.status !== undefined) cleanUpdates.status = updates.status;

      if (isDemoMode) {
        setGeneratedContents((prev) => prev.map((c) => (c.id === id ? { ...c, ...cleanUpdates } : c)));
        return;
      }
      try {
        await updateDoc(doc(db, 'generatedContents', id), { ...cleanUpdates, updatedAt: serverTimestamp() });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `generatedContents/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const deleteGeneratedContent = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      if (isDemoMode) {
        setGeneratedContents((prev) => prev.filter((c) => c.id !== id));
        return;
      }
      try {
        await deleteDoc(doc(db, 'generatedContents', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `generatedContents/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const addDemoVisitorEvent = useCallback((evt: Omit<VisitorEvent, 'id' | 'ownerId' | 'createdAt'>) => {
    const id = makeId('evt');
    setVisitorEvents((prev) => [
      { id, ownerId: 'demo_user', ...evt, createdAt: { toMillis: () => Date.now() } },
      ...prev,
    ]);
  }, []);

  // Leads
  const addLead = useCallback(
    async (input: {
      websiteId: string;
      name: string;
      email: string;
      phone?: string;
      company?: string;
      leadSource: LeadSource;
      status: LeadStatus;
      estimatedValue: number;
      notes?: string;
      trackingSource?: 'tracked' | 'manual';
    }) => {
      const uid = ensureWriteAllowed();
      const id = makeId('lead');
      const payload = {
        ownerId: uid,
        websiteId: input.websiteId,
        name: input.name.trim().slice(0, 140),
        email: input.email.trim().slice(0, 254),
        phone: (input.phone || '').trim().slice(0, 40),
        company: (input.company || '').trim().slice(0, 140),
        leadSource: input.leadSource,
        status: input.status,
        estimatedValue: Math.max(0, Math.min(100000000, Number(input.estimatedValue) || 0)),
        notes: (input.notes || '').trim().slice(0, 2000),
        trackingSource: input.trackingSource || ('manual' as const),
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
        updatedAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };
      if (isDemoMode) {
        setLeads((prev) => [{ id, ...payload }, ...prev]);
        return id;
      }
      try {
        await setDoc(doc(db, 'leads', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `leads/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const updateLead = useCallback(
    async (
      id: string,
      updates: Partial<{
        name: string;
        email: string;
        phone: string;
        company: string;
        leadSource: LeadSource;
        status: LeadStatus;
        estimatedValue: number;
        notes: string;
      }>
    ) => {
      ensureWriteAllowed();
      const cleanUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) cleanUpdates.name = updates.name.trim().slice(0, 140);
      if (updates.email !== undefined) cleanUpdates.email = updates.email.trim().slice(0, 254);
      if (updates.phone !== undefined) cleanUpdates.phone = updates.phone.trim().slice(0, 40);
      if (updates.company !== undefined) cleanUpdates.company = updates.company.trim().slice(0, 140);
      if (updates.leadSource !== undefined) cleanUpdates.leadSource = updates.leadSource;
      if (updates.status !== undefined) cleanUpdates.status = updates.status;
      if (updates.estimatedValue !== undefined) {
        cleanUpdates.estimatedValue = Math.max(0, Math.min(100000000, Number(updates.estimatedValue) || 0));
      }
      if (updates.notes !== undefined) cleanUpdates.notes = updates.notes.trim().slice(0, 2000);

      if (isDemoMode) {
        setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...cleanUpdates } : l)));
        return;
      }
      try {
        await updateDoc(doc(db, 'leads', id), { ...cleanUpdates, updatedAt: serverTimestamp() });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `leads/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const deleteLead = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      if (isDemoMode) {
        setLeads((prev) => prev.filter((l) => l.id !== id));
        return;
      }
      try {
        await deleteDoc(doc(db, 'leads', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `leads/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  // Quotes
  const addQuote = useCallback(
    async (input: {
      websiteId: string;
      leadId?: string;
      customerName: string;
      customerEmail: string;
      serviceOrProduct: string;
      amount: number;
      currency?: string;
      status: QuoteStatus;
      validUntil?: string;
      notes?: string;
    }) => {
      const uid = ensureWriteAllowed();
      const id = makeId('qt');
      const payload = {
        ownerId: uid,
        websiteId: input.websiteId,
        leadId: (input.leadId || '').slice(0, 128),
        customerName: input.customerName.trim().slice(0, 140),
        customerEmail: input.customerEmail.trim().slice(0, 254),
        serviceOrProduct: input.serviceOrProduct.trim().slice(0, 240),
        amount: Math.max(0, Math.min(100000000, Number(input.amount) || 0)),
        currency: (input.currency || 'USD').slice(0, 6),
        status: input.status,
        validUntil: (input.validUntil || '').slice(0, 32),
        notes: (input.notes || '').trim().slice(0, 2000),
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
        updatedAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };
      if (isDemoMode) {
        setQuotes((prev) => [{ id, ...payload }, ...prev]);
        return id;
      }
      try {
        await setDoc(doc(db, 'quotes', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `quotes/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const updateQuote = useCallback(
    async (
      id: string,
      updates: Partial<{
        customerName: string;
        customerEmail: string;
        serviceOrProduct: string;
        amount: number;
        currency: string;
        status: QuoteStatus;
        validUntil: string;
        notes: string;
      }>
    ) => {
      ensureWriteAllowed();
      const cleanUpdates: Record<string, unknown> = {};
      if (updates.customerName !== undefined) cleanUpdates.customerName = updates.customerName.trim().slice(0, 140);
      if (updates.customerEmail !== undefined) cleanUpdates.customerEmail = updates.customerEmail.trim().slice(0, 254);
      if (updates.serviceOrProduct !== undefined) cleanUpdates.serviceOrProduct = updates.serviceOrProduct.trim().slice(0, 240);
      if (updates.amount !== undefined) {
        cleanUpdates.amount = Math.max(0, Math.min(100000000, Number(updates.amount) || 0));
      }
      if (updates.currency !== undefined) cleanUpdates.currency = updates.currency.slice(0, 6);
      if (updates.status !== undefined) cleanUpdates.status = updates.status;
      if (updates.validUntil !== undefined) cleanUpdates.validUntil = updates.validUntil.slice(0, 32);
      if (updates.notes !== undefined) cleanUpdates.notes = updates.notes.trim().slice(0, 2000);

      if (isDemoMode) {
        setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, ...cleanUpdates } : q)));
        return;
      }
      try {
        await updateDoc(doc(db, 'quotes', id), { ...cleanUpdates, updatedAt: serverTimestamp() });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `quotes/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const deleteQuote = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      if (isDemoMode) {
        setQuotes((prev) => prev.filter((q) => q.id !== id));
        return;
      }
      try {
        await deleteDoc(doc(db, 'quotes', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `quotes/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  // Orders
  const addOrder = useCallback(
    async (input: {
      websiteId: string;
      orderNumber?: string;
      customerName: string;
      customerEmail: string;
      productOrService: string;
      amount: number;
      currency?: string;
      channel: OrderChannel;
      entrySource: OrderEntrySource;
      status: OrderStatus;
      orderDate: string;
    }) => {
      const uid = ensureWriteAllowed();
      const id = makeId('ord');
      const payload = {
        ownerId: uid,
        websiteId: input.websiteId,
        orderNumber: (input.orderNumber || `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`).slice(0, 64),
        customerName: input.customerName.trim().slice(0, 140),
        customerEmail: input.customerEmail.trim().slice(0, 254),
        productOrService: input.productOrService.trim().slice(0, 240),
        amount: Math.max(0, Math.min(100000000, Number(input.amount) || 0)),
        currency: (input.currency || 'USD').slice(0, 6),
        channel: input.channel,
        entrySource: input.entrySource,
        status: input.status,
        orderDate: input.orderDate.slice(0, 32),
        createdAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
        updatedAt: isDemoMode ? { toMillis: () => Date.now() } : serverTimestamp(),
      };
      if (isDemoMode) {
        setOrders((prev) => [{ id, ...payload }, ...prev]);
        return id;
      }
      try {
        await setDoc(doc(db, 'orders', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `orders/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const updateOrder = useCallback(
    async (
      id: string,
      updates: Partial<{
        orderNumber: string;
        customerName: string;
        customerEmail: string;
        productOrService: string;
        amount: number;
        currency: string;
        channel: OrderChannel;
        status: OrderStatus;
        orderDate: string;
      }>
    ) => {
      ensureWriteAllowed();
      const cleanUpdates: Record<string, unknown> = {};
      if (updates.orderNumber !== undefined) cleanUpdates.orderNumber = updates.orderNumber.trim().slice(0, 64);
      if (updates.customerName !== undefined) cleanUpdates.customerName = updates.customerName.trim().slice(0, 140);
      if (updates.customerEmail !== undefined) cleanUpdates.customerEmail = updates.customerEmail.trim().slice(0, 254);
      if (updates.productOrService !== undefined) cleanUpdates.productOrService = updates.productOrService.trim().slice(0, 240);
      if (updates.amount !== undefined) {
        cleanUpdates.amount = Math.max(0, Math.min(100000000, Number(updates.amount) || 0));
      }
      if (updates.currency !== undefined) cleanUpdates.currency = updates.currency.slice(0, 6);
      if (updates.channel !== undefined) cleanUpdates.channel = updates.channel;
      if (updates.status !== undefined) cleanUpdates.status = updates.status;
      if (updates.orderDate !== undefined) cleanUpdates.orderDate = updates.orderDate.slice(0, 32);

      if (isDemoMode) {
        setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...cleanUpdates } : o)));
        return;
      }
      try {
        await updateDoc(doc(db, 'orders', id), { ...cleanUpdates, updatedAt: serverTimestamp() });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `orders/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  const deleteOrder = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      if (isDemoMode) {
        setOrders((prev) => prev.filter((o) => o.id !== id));
        return;
      }
      try {
        await deleteDoc(doc(db, 'orders', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `orders/${id}`);
      }
    },
    [ensureWriteAllowed, isDemoMode]
  );

  // Integrations
  const saveIntegrationConfig = useCallback(
    async (input: {
      websiteId: string;
      provider: IntegrationProvider;
      status: 'not_connected' | 'configured';
      identifier?: string;
      notes?: string;
    }) => {
      const uid = ensureWriteAllowed();
      const existing = integrations.find(
        (i) => i.websiteId === input.websiteId && i.provider === input.provider
      );
      if (isDemoMode) {
        if (existing) {
          setIntegrations((prev) =>
            prev.map((i) =>
              i.id === existing.id
                ? { ...i, status: input.status, identifier: input.identifier, notes: input.notes }
                : i
            )
          );
        } else {
          setIntegrations((prev) => [
            {
              id: makeId('int'),
              ownerId: uid,
              websiteId: input.websiteId,
              provider: input.provider,
              status: input.status,
              identifier: input.identifier,
              notes: input.notes,
              createdAt: { toMillis: () => Date.now() },
              updatedAt: { toMillis: () => Date.now() },
            },
            ...prev,
          ]);
        }
        return;
      }

      if (existing) {
        try {
          await updateDoc(doc(db, 'integrations', existing.id), {
            status: input.status,
            identifier: (input.identifier || '').trim().slice(0, 254),
            notes: (input.notes || '').trim().slice(0, 500),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `integrations/${existing.id}`);
        }
      } else {
        const id = makeId('int');
        try {
          await setDoc(doc(db, 'integrations', id), {
            ownerId: uid,
            websiteId: input.websiteId,
            provider: input.provider,
            status: input.status,
            identifier: (input.identifier || '').trim().slice(0, 254),
            notes: (input.notes || '').trim().slice(0, 500),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `integrations/${id}`);
        }
      }
    },
    [ensureWriteAllowed, integrations, isDemoMode]
  );

  return {
    websites,
    seoAudits,
    siteCrawls,
    wpConnections,
    wpEntities,
    seoOptimizations,
    gscSnapshots,
    trackedKeywords,
    technicalSnapshots,
    syncLogs,
    keywordProjects,
    generatedContents,
    visitorEvents,
    leads,
    quotes,
    orders,
    integrations,
    loading,
    error,
    addWebsite,
    updateWebsite,
    deleteWebsite,
    saveSeoAudit,
    createOptimization,
    updateOptimizationDraft,
    deleteOptimization,
    addTrackedKeyword,
    deleteTrackedKeyword,
    saveKeywordProject,
    deleteKeywordProject,
    saveGeneratedContent,
    updateGeneratedContent,
    deleteGeneratedContent,
    addDemoVisitorEvent,
    addLead,
    updateLead,
    deleteLead,
    addQuote,
    updateQuote,
    deleteQuote,
    addOrder,
    updateOrder,
    deleteOrder,
    saveIntegrationConfig,
  };
}
