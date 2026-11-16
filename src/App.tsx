import React, { Component, ErrorInfo, ReactNode, useEffect, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { useWorkspaceData } from './hooks/useWorkspaceData';
import { Lead, NavSection, OrderChannel, Quote, Website } from './types';
import { AuthView } from './views/AuthView';
import { ContentStudioView } from './views/ContentStudioView';
import { DashboardView } from './views/DashboardView';
import { IntegrationsView } from './views/IntegrationsView';
import { KeywordResearchView } from './views/KeywordResearchView';
import { LeadsView } from './views/LeadsView';
import { OrdersView } from './views/OrdersView';
import { ProfileSettingsView } from './views/ProfileSettingsView';
import { QuotesView } from './views/QuotesView';
import { SalesAnalyticsView } from './views/SalesAnalyticsView';
import { SeoAnalyzerView } from './views/SeoAnalyzerView';
import { VisitorTrackingView } from './views/VisitorTrackingView';
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

const LEAD_TO_ORDER_CHANNEL: Record<string, OrderChannel> = {
  'Organic Search': 'Organic Search',
  Direct: 'Direct',
  Referral: 'Referral',
  'Paid Search': 'Paid Search',
  Social: 'Social',
};

function WorkspaceApp() {
  const { user, authReady, isDemoMode } = useAuth();
  const { toast } = useToast();
  const data = useWorkspaceData();

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string>('all');
  const [showAddWebsiteModal, setShowAddWebsiteModal] = useState(false);

  const [scanTargetUrl, setScanTargetUrl] = useState<string | undefined>(undefined);
  const [contentPrefillKeyword, setContentPrefillKeyword] = useState<string | undefined>(undefined);
  const [contentPrefillTitle, setContentPrefillTitle] = useState<string | undefined>(undefined);
  const [quotePrefillLead, setQuotePrefillLead] = useState<Lead | null>(null);

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

  if (!user && !isDemoMode) {
    return <AuthView />;
  }

  const handleQuickAddWebsite = () => {
    setActiveSection('websites');
    setShowAddWebsiteModal(true);
  };

  const handleScanWebsite = (site: Website) => {
    setSelectedWebsiteId(site.id);
    setScanTargetUrl(site.url);
    setActiveSection('seo-analyzer');
  };

  const handleSendToContentStudio = (keyword: string, title?: string) => {
    setContentPrefillKeyword(keyword);
    setContentPrefillTitle(title);
    setActiveSection('content-studio');
  };

  const handleConvertLeadToQuote = (lead: Lead) => {
    setQuotePrefillLead(lead);
    setActiveSection('quotes');
  };

  const handleAcceptQuote = async (quote: Quote) => {
    await data.updateQuote(quote.id, { status: 'Accepted' });
    if (quote.leadId) {
      const linkedLead = data.leads.find((l) => l.id === quote.leadId);
      if (linkedLead && linkedLead.status !== 'Converted') {
        await data.updateLead(linkedLead.id, { status: 'Converted' });
      }
    }
  };

  const handleConvertQuoteToOrder = async (quote: Quote) => {
    const linkedLead = quote.leadId ? data.leads.find((l) => l.id === quote.leadId) : undefined;
    const channel: OrderChannel =
      (linkedLead && LEAD_TO_ORDER_CHANNEL[linkedLead.leadSource]) || 'Manual Entry';
    const entrySource =
      linkedLead?.trackingSource === 'tracked' ? 'tracked_conversion' : 'manual_entry';

    await data.addOrder({
      websiteId: quote.websiteId,
      customerName: quote.customerName,
      customerEmail: quote.customerEmail,
      productOrService: quote.serviceOrProduct,
      amount: quote.amount,
      currency: quote.currency,
      channel,
      entrySource,
      status: 'Completed',
      orderDate: new Date().toISOString().slice(0, 10),
    });

    if (linkedLead && linkedLead.status !== 'Converted') {
      await data.updateLead(linkedLead.id, { status: 'Converted' });
    }

    toast({
      title: 'Order created from accepted quote',
      description: `${quote.customerName} · $${quote.amount.toLocaleString()}`,
      variant: 'success',
    });
    setActiveSection('orders');
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
          visitorEvents={data.visitorEvents}
          leads={data.leads}
          quotes={data.quotes}
          orders={data.orders}
          selectedWebsiteId={selectedWebsiteId}
          loading={data.loading}
          error={data.error}
          onNavigate={setActiveSection}
          onAddWebsite={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'websites' && (
        <WebsitesView
          websites={data.websites}
          seoAudits={data.seoAudits}
          visitorEvents={data.visitorEvents}
          leads={data.leads}
          orders={data.orders}
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

      {activeSection === 'seo-analyzer' && (
        <SeoAnalyzerView
          websites={data.websites}
          seoAudits={data.seoAudits}
          selectedWebsiteId={selectedWebsiteId}
          initialTargetUrl={scanTargetUrl}
          onSaveAudit={data.saveSeoAudit}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'keyword-research' && (
        <KeywordResearchView
          websites={data.websites}
          keywordProjects={data.keywordProjects}
          selectedWebsiteId={selectedWebsiteId}
          onSaveProject={data.saveKeywordProject}
          onDeleteProject={data.deleteKeywordProject}
          onSendToContentStudio={handleSendToContentStudio}
        />
      )}

      {activeSection === 'content-studio' && (
        <ContentStudioView
          websites={data.websites}
          contents={data.generatedContents}
          selectedWebsiteId={selectedWebsiteId}
          prefillKeyword={contentPrefillKeyword}
          prefillTitle={contentPrefillTitle}
          onSaveContent={data.saveGeneratedContent}
          onUpdateContent={data.updateGeneratedContent}
          onDeleteContent={data.deleteGeneratedContent}
        />
      )}

      {activeSection === 'visitor-tracking' && (
        <VisitorTrackingView
          websites={data.websites}
          visitorEvents={data.visitorEvents}
          selectedWebsiteId={selectedWebsiteId}
          onAddDemoEvent={data.addDemoVisitorEvent}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'leads' && (
        <LeadsView
          websites={data.websites}
          leads={data.leads}
          selectedWebsiteId={selectedWebsiteId}
          loading={data.loading}
          onAddLead={data.addLead}
          onUpdateLead={data.updateLead}
          onDeleteLead={data.deleteLead}
          onConvertLeadToQuote={handleConvertLeadToQuote}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'quotes' && (
        <QuotesView
          websites={data.websites}
          quotes={data.quotes}
          selectedWebsiteId={selectedWebsiteId}
          loading={data.loading}
          prefillLead={quotePrefillLead}
          onClearPrefillLead={() => setQuotePrefillLead(null)}
          onAddQuote={data.addQuote}
          onUpdateQuote={data.updateQuote}
          onAcceptQuote={handleAcceptQuote}
          onDeleteQuote={data.deleteQuote}
          onConvertQuoteToOrder={handleConvertQuoteToOrder}
          onAddWebsitePrompt={handleQuickAddWebsite}
        />
      )}

      {activeSection === 'orders' && (
        <OrdersView
          websites={data.websites}
          orders={data.orders}
          selectedWebsiteId={selectedWebsiteId}
          loading={data.loading}
          onAddOrder={data.addOrder}
          onUpdateOrder={data.updateOrder}
          onDeleteOrder={data.deleteOrder}
          onAddWebsitePrompt={handleQuickAddWebsite}
          onOpenIntegrations={() => setActiveSection('integrations')}
        />
      )}

      {activeSection === 'sales-analytics' && (
        <SalesAnalyticsView
          visitorEvents={data.visitorEvents}
          leads={data.leads}
          quotes={data.quotes}
          orders={data.orders}
          selectedWebsiteId={selectedWebsiteId}
        />
      )}

      {activeSection === 'integrations' && (
        <IntegrationsView
          websites={data.websites}
          integrations={data.integrations}
          selectedWebsiteId={selectedWebsiteId}
          onSaveConfig={data.saveIntegrationConfig}
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
