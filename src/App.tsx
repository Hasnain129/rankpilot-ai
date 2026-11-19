import React, { Component, ErrorInfo, ReactNode, useEffect, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { useWorkspaceData } from './hooks/useWorkspaceData';
import { CrawledPageSummary, NavSection, Website } from './types';
import { AiRecommendationsView } from './views/AiRecommendationsView';
import { AuthView } from './views/AuthView';
import { DashboardView } from './views/DashboardView';
import { Ga4IntegrationView } from './views/Ga4IntegrationView';
import { KeywordResearchView } from './views/KeywordResearchView';
import { OptimizationCenterView, OptimizationPrefill } from './views/OptimizationCenterView';
import { ProfileSettingsView } from './views/ProfileSettingsView';
import { RankTrackerView } from './views/RankTrackerView';
import { SearchConsoleView } from './views/SearchConsoleView';
import { SeoAnalyzerView } from './views/SeoAnalyzerView';
import { SeoReportsView } from './views/SeoReportsView';
import { TechnicalMonitorView } from './views/TechnicalMonitorView';
import { WebsitesView } from './views/WebsitesView';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RankPilot AI boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
          <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-900/60 dark:bg-slate-900">
            <h1 className="font-display text-base font-bold text-red-700 dark:text-red-400">
              Workspace Error Encountered
            </h1>
            <p className="mt-2 break-words text-xs text-slate-600 dark:text-slate-400">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function WorkspaceApp() {
  const { user, authReady } = useAuth();
  const { toast } = useToast();
  const data = useWorkspaceData();

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string>('all');
  const [showAddWebsiteModal, setShowAddWebsiteModal] = useState(false);

  const [scanTargetUrl, setScanTargetUrl] = useState<string | undefined>(undefined);
  const [optimizePrefill, setOptimizePrefill] = useState<OptimizationPrefill | null>(null);
  const [onPageInitialTab, setOnPageInitialTab] = useState<'drafts' | 'wordpress' | undefined>(undefined);
  const [technicalPrefillUrl, setTechnicalPrefillUrl] = useState<string | undefined>(undefined);

  // Reset scope if currently selected website was deleted
  useEffect(() => {
    if (
      selectedWebsiteId !== 'all' &&
      !data.loading &&
      !data.websites.some((w) => w.id === selectedWebsiteId)
    ) {
      setSelectedWebsiteId('all');
    }
  }, [selectedWebsiteId, data.websites, data.loading]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Initializing RankPilot AI...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView />;
  }

  const resolvedWebsiteId =
    selectedWebsiteId !== 'all' ? selectedWebsiteId : data.websites[0]?.id || '';

  const handleQuickAddWebsite = () => {
    setActiveSection('websites');
    setShowAddWebsiteModal(true);
  };

  const handleScanWebsite = (site: Website) => {
    setSelectedWebsiteId(site.id);
    setScanTargetUrl(site.url);
    setActiveSection('website-audit');
  };

  const handleSendPageToOptimizer = (page: CrawledPageSummary, websiteId: string) => {
    setSelectedWebsiteId(websiteId);
    setOptimizePrefill({
      websiteId,
      entityType: 'url',
      targetUrl: page.url,
      title: page.title || page.h1,
    });
    setOnPageInitialTab('drafts');
    setActiveSection('on-page-seo');
  };

  const handleSendKeywordToOnPageSeo = (keyword: string, suggestedTitleOrUrl?: string) => {
    const activeSite =
      (selectedWebsiteId !== 'all'
        ? data.websites.find((w) => w.id === selectedWebsiteId)
        : data.websites[0]) || null;
    if (!activeSite) {
      handleQuickAddWebsite();
      return;
    }
    const isUrl = Boolean(suggestedTitleOrUrl && /^https?:\/\//i.test(suggestedTitleOrUrl));
    setOptimizePrefill({
      websiteId: activeSite.id,
      entityType: 'url',
      targetUrl: isUrl ? suggestedTitleOrUrl! : activeSite.url,
      title: isUrl ? undefined : suggestedTitleOrUrl,
      targetKeyword: keyword,
    });
    setOnPageInitialTab('drafts');
    setActiveSection('on-page-seo');
  };

  const handleOptimizeUrlFromGsc = (url: string, websiteId: string, query?: string) => {
    setSelectedWebsiteId(websiteId);
    setOptimizePrefill({
      websiteId,
      entityType: 'url',
      targetUrl: url,
      targetKeyword: query,
    });
    setOnPageInitialTab('drafts');
    setActiveSection('on-page-seo');
  };

  const handleTrackKeywordFromGsc = async (keyword: string, url: string, websiteId: string) => {
    await data.addTrackedKeyword({
      websiteId,
      keyword,
      targetUrl: url,
      country: 'US',
      language: 'en',
      device: 'desktop',
    });
    toast({
      title: `Added "${keyword}" to Rank Tracker`,
      variant: 'success',
    });
    setActiveSection('rank-tracker');
  };

  const handleRecommendationTarget = (section: NavSection, url?: string) => {
    if (section === 'technical-seo') {
      setTechnicalPrefillUrl(url);
    } else if (section === 'website-audit' && url) {
      setScanTargetUrl(url);
    } else if (section === 'on-page-seo' && url && resolvedWebsiteId) {
      setOptimizePrefill({
        websiteId: resolvedWebsiteId,
        entityType: 'url',
        targetUrl: url,
      });
      setOnPageInitialTab('drafts');
    }
    setActiveSection(section);
  };

  return (
    <AppShell
      activeSection={activeSection}
      onNavigate={setActiveSection}
      websites={data.websites}
      selectedWebsiteId={selectedWebsiteId}
      onSelectWebsite={setSelectedWebsiteId}
      onQuickAddWebsite={handleQuickAddWebsite}
    >
      {activeSection === 'dashboard' && (
        <DashboardView
          websites={data.websites}
          seoAudits={data.seoAudits}
          siteCrawls={data.siteCrawls}
          seoOptimizations={data.seoOptimizations}
          gscSnapshots={data.gscSnapshots}
          analyticsSnapshots={data.analyticsSnapshots}
          trackedKeywords={data.trackedKeywords}
          technicalSnapshots={data.technicalSnapshots}
          seoRecommendations={data.seoRecommendations}
          selectedWebsiteId={selectedWebsiteId}
          loading={data.loading}
          error={data.error}
          onNavigate={setActiveSection}
          onAddWebsite={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'website-audit' && (
        <SeoAnalyzerView
          websites={data.websites}
          seoAudits={data.seoAudits}
          siteCrawls={data.siteCrawls}
          selectedWebsiteId={selectedWebsiteId}
          initialTargetUrl={scanTargetUrl}
          onSaveAudit={data.saveSeoAudit}
          onAddWebsitePrompt={handleQuickAddWebsite}
          onSendPageToOptimizer={handleSendPageToOptimizer}
        />
      )}

      {activeSection === 'keyword-research' && (
        <KeywordResearchView
          websites={data.websites}
          keywordProjects={data.keywordProjects}
          siteCrawls={data.siteCrawls}
          wpEntities={data.wpEntities}
          selectedWebsiteId={selectedWebsiteId}
          onSaveProject={data.saveKeywordProject}
          onAssignKeywordToPage={data.assignKeywordToPage}
          onDeleteProject={data.deleteKeywordProject}
          onSendToOnPageSeo={handleSendKeywordToOnPageSeo}
          onAddTrackedKeyword={data.addTrackedKeyword}
        />
      )}

      {activeSection === 'rank-tracker' && (
        <RankTrackerView
          websites={data.websites}
          trackedKeywords={data.trackedKeywords}
          gscSnapshots={data.gscSnapshots}
          selectedWebsiteId={selectedWebsiteId}
          onAddTrackedKeyword={data.addTrackedKeyword}
          onDeleteTrackedKeyword={data.deleteTrackedKeyword}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}


      {activeSection === 'on-page-seo' && (
        <OptimizationCenterView
          websites={data.websites}
          wpConnections={data.wpConnections}
          wpEntities={data.wpEntities}
          syncLogs={data.syncLogs}
          siteCrawls={data.siteCrawls}
          optimizations={data.seoOptimizations}
          selectedWebsiteId={selectedWebsiteId}
          initialTab={onPageInitialTab}
          onConsumeInitialTab={() => setOnPageInitialTab(undefined)}
          prefill={optimizePrefill}
          onClearPrefill={() => setOptimizePrefill(null)}
          onCreateOptimization={data.createOptimization}
          onUpdateOptimization={data.updateOptimizationDraft}
          onDeleteOptimization={data.deleteOptimization}
          onSaveAudit={data.saveSeoAudit}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'technical-seo' && (
        <TechnicalMonitorView
          websites={data.websites}
          technicalSnapshots={data.technicalSnapshots}
          siteCrawls={data.siteCrawls}
          selectedWebsiteId={selectedWebsiteId}
          initialUrl={technicalPrefillUrl}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'ai-recommendations' && (
        <AiRecommendationsView
          websites={data.websites}
          seoRecommendations={data.seoRecommendations}
          seoAudits={data.seoAudits}
          siteCrawls={data.siteCrawls}
          gscSnapshots={data.gscSnapshots}
          analyticsSnapshots={data.analyticsSnapshots}
          technicalSnapshots={data.technicalSnapshots}
          selectedWebsiteId={selectedWebsiteId}
          onUpdateStatus={data.updateRecommendationStatus}
          onDelete={data.deleteRecommendation}
          onNavigateToTarget={handleRecommendationTarget}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'seo-reports' && (
        <SeoReportsView
          websites={data.websites}
          seoAudits={data.seoAudits}
          siteCrawls={data.siteCrawls}
          gscSnapshots={data.gscSnapshots}
          analyticsSnapshots={data.analyticsSnapshots}
          trackedKeywords={data.trackedKeywords}
          technicalSnapshots={data.technicalSnapshots}
          seoRecommendations={data.seoRecommendations}
          selectedWebsiteId={selectedWebsiteId}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'websites' && (
        <WebsitesView
          websites={data.websites}
          seoAudits={data.seoAudits}
          siteCrawls={data.siteCrawls}
          loading={data.loading}
          showAddModal={showAddWebsiteModal}
          onOpenAddModal={() => setShowAddWebsiteModal(true)}
          onCloseAddModal={() => setShowAddWebsiteModal(false)}
          onAddWebsite={data.addWebsite}
          onUpdateWebsite={data.updateWebsite}
          onDeleteWebsite={data.deleteWebsite}
          onScanWebsite={handleScanWebsite}
        />
      )}

      {activeSection === 'search-console' && (
        <SearchConsoleView
          websites={data.websites}
          gscSnapshots={data.gscSnapshots}
          selectedWebsiteId={selectedWebsiteId}
          onAddWebsitePrompt={handleQuickAddWebsite}
          onOptimizeUrl={handleOptimizeUrlFromGsc}
          onTrackKeyword={handleTrackKeywordFromGsc}
        />
      )}

      {activeSection === 'ga4-integration' && (
        <Ga4IntegrationView
          websites={data.websites}
          analyticsSnapshots={data.analyticsSnapshots}
          selectedWebsiteId={selectedWebsiteId}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'profile' && <ProfileSettingsView />}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <WorkspaceApp />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
