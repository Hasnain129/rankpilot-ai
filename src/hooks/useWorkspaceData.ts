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
import { OperationType, db, handleFirestoreError } from '../lib/firebase';
import {
  AiSeoRecommendation,
  AnalyticsSnapshot,
  GscSnapshot,
  KeywordAssignment,
  KeywordProject,
  OptimizationDraftFields,
  RecommendationStatus,
  SeoAudit,
  SeoOptimization,
  SiteCrawl,
  SyncLog,
  TechnicalSnapshot,
  TrackedKeyword,
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
  const { user, authReady } = useAuth();

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
  const [seoRecommendations, setSeoRecommendations] = useState<AiSeoRecommendation[]>([]);
  const [analyticsSnapshots, setAnalyticsSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
      setSeoRecommendations([]);
      setAnalyticsSnapshots([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const uid = user.uid;
    let settledCount = 0;
    const totalListeners = 13;
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
      listen<AiSeoRecommendation>('seoRecommendations', setSeoRecommendations),
      listen<AnalyticsSnapshot>('analyticsSnapshots', setAnalyticsSnapshots),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [user, authReady]);

  const ensureWriteAllowed = useCallback(() => {
    if (!user) throw new Error('Please sign in to save changes.');
    if (!user.emailVerified) {
      throw new Error('Please verify your email address before saving data to Firestore.');
    }
    return user.uid;
  }, [user]);

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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

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
    [ensureWriteAllowed]
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
    [ensureWriteAllowed]
  );

  const deleteWebsite = useCallback(
    async (website: Website) => {
      ensureWriteAllowed();
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'websites', website.id));
        if (website.trackingId) batch.delete(doc(db, 'trackingKeys', website.trackingId));
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `websites/${website.id}`);
      }
    },
    [ensureWriteAllowed]
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
        redirectChain: (audit.redirectChain || []).slice(0, 10),
        redirectCount: Math.max(0, Math.min(20, Math.round(audit.redirectCount || 0))),
        metaRobots: (audit.metaRobots || '').slice(0, 200),
        xRobotsTag: (audit.xRobotsTag || '').slice(0, 200),
        issues: (audit.issues || []).slice(0, 30),
        recommendations: (audit.recommendations || []).slice(0, 20),
        summary: (audit.summary || '').slice(0, 2000),
        createdAt: serverTimestamp(),
      };

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
    [ensureWriteAllowed, websites]
  );

  // SEO Optimization Center CRUD
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(doc(db, 'seoOptimizations', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `seoOptimizations/${id}`);
      }
    },
    [ensureWriteAllowed]
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

      try {
        await updateDoc(doc(db, 'seoOptimizations', id), {
          ...clean,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `seoOptimizations/${id}`);
      }
    },
    [ensureWriteAllowed]
  );

  const deleteOptimization = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      try {
        await deleteDoc(doc(db, 'seoOptimizations', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `seoOptimizations/${id}`);
      }
    },
    [ensureWriteAllowed]
  );

  // Tracked Keywords
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      try {
        await setDoc(doc(db, 'trackedKeywords', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `trackedKeywords/${id}`);
      }
    },
    [ensureWriteAllowed]
  );

  const deleteTrackedKeyword = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      try {
        await deleteDoc(doc(db, 'trackedKeywords', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `trackedKeywords/${id}`);
      }
    },
    [ensureWriteAllowed]
  );

  // Keyword Research
  const saveKeywordProject = useCallback(
    async (project: Omit<KeywordProject, 'id' | 'ownerId' | 'createdAt'>): Promise<string | void> => {
      const uid = ensureWriteAllowed();
      const id = makeId('kw');
      const payload = {
        ownerId: uid,
        websiteId: (project.websiteId || 'all').slice(0, 128),
        seedKeyword: project.seedKeyword.slice(0, 160),
        targetMarket: (project.targetMarket || 'Global').slice(0, 80),
        country: (project.country || 'US').slice(0, 16),
        language: (project.language || 'en').slice(0, 16),
        sourceType: project.sourceType || ('keyword' as const),
        targetUrl: (project.targetUrl || '').slice(0, 500),
        relatedKeywords: (project.relatedKeywords || []).slice(0, 25),
        longTailKeywords: (project.longTailKeywords || []).slice(0, 25),
        keywordItems: (project.keywordItems || []).slice(0, 80),
        synonyms: (project.synonyms || []).slice(0, 30),
        opportunities: (project.opportunities || []).slice(0, 25),
        assignments: (project.assignments || []).slice(0, 80),
        dataNotice: (project.dataNotice || '').slice(0, 600),
        clusters: (project.clusters || []).slice(0, 15),
        contentIdeas: (project.contentIdeas || []).slice(0, 15),
        suggestedTitles: (project.suggestedTitles || []).slice(0, 15),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      try {
        await setDoc(doc(db, 'keywordProjects', id), payload);
        return id;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `keywordProjects/${id}`);
      }
    },
    [ensureWriteAllowed]
  );

  const assignKeywordToPage = useCallback(
    async (projectId: string, assignment: KeywordAssignment) => {
      ensureWriteAllowed();
      const targetProj = keywordProjects.find((p) => p.id === projectId);
      const currentList = targetProj?.assignments || [];
      const nextAssignments = [
        ...currentList.filter((a) => a.keyword.toLowerCase() !== assignment.keyword.toLowerCase()),
        assignment,
      ].slice(0, 80);

      try {
        await updateDoc(doc(db, 'keywordProjects', projectId), {
          assignments: nextAssignments,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `keywordProjects/${projectId}`);
      }
    },
    [ensureWriteAllowed, keywordProjects]
  );

  const deleteKeywordProject = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      try {
        await deleteDoc(doc(db, 'keywordProjects', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `keywordProjects/${id}`);
      }
    },
    [ensureWriteAllowed]
  );

  // AI SEO Recommendations
  const updateRecommendationStatus = useCallback(
    async (id: string, status: RecommendationStatus) => {
      ensureWriteAllowed();
      try {
        await updateDoc(doc(db, 'seoRecommendations', id), {
          status,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `seoRecommendations/${id}`);
      }
    },
    [ensureWriteAllowed]
  );

  const deleteRecommendation = useCallback(
    async (id: string) => {
      ensureWriteAllowed();
      try {
        await deleteDoc(doc(db, 'seoRecommendations', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `seoRecommendations/${id}`);
      }
    },
    [ensureWriteAllowed]
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
    seoRecommendations,
    analyticsSnapshots,
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
    assignKeywordToPage,
    deleteKeywordProject,
    updateRecommendationStatus,
    deleteRecommendation,
  };
}
