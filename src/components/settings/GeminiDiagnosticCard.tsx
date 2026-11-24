import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { ApiRequestError, apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import { ErrorBanner, StatusText } from '../ui/DataState';

interface CatalogModelInfo {
  id: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

interface GeminiModelCatalogResult {
  success: boolean;
  status: number;
  apiStatus: string;
  latencyMs: number;
  totalListed: number;
  generateContentSupportedCount: number;
  generateContentModels: string[];
  models: CatalogModelInfo[];
  errorReason?: string;
}

interface DiagnosticCallResult {
  success: boolean;
  status: number;
  apiStatus: string;
  latencyMs: number;
  outputPreview?: string;
  validJson?: boolean;
  errorReason?: string;
}

interface DiagnosticModelResult {
  model: string;
  inModelsList: boolean;
  textTest: DiagnosticCallResult;
  structuredJsonTest: DiagnosticCallResult | null;
}

interface GeminiDiagnosticReport {
  diagnosticEnabled: true;
  executedAt: string;
  configured: {
    primaryModel: string;
    fallbackModels: string[];
    unchanged: true;
  };
  limits?: {
    maxModelsTested: number;
    maxCallsPerModel: number;
    perCallTimeoutMs: number;
    totalBudgetMs: number;
  };
  modelsList: GeminiModelCatalogResult;
  modelTests: DiagnosticModelResult[];
  summary: {
    workingTextModels: string[];
    workingStructuredJsonModels: string[];
    unavailable503Models: string[];
    skippedUnlistedModels?: string[];
    otherFailedModels: Array<{ model: string; status: number; apiStatus: string }>;
    budgetExhausted: boolean;
  };
  cleanupReminder: string;
}

interface DiagnosticEligibilityResponse {
  enabled: boolean;
  authorized: boolean;
  configured?: {
    primaryModel: string;
    fallbackModels: string[];
  };
  catalog?: GeminiModelCatalogResult;
}

const MAX_SELECTABLE_MODELS = 4;
const CLIENT_DIAGNOSTIC_TIMEOUT_MS = 125_000;

function formatDiagnosticError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Diagnostic request timed out after 125 seconds before the server finished. Please try again.';
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return 'Diagnostic request timed out before completing. Please try again.';
  }
  if (err instanceof ApiRequestError) {
    switch (err.status) {
      case 400:
        return `Invalid diagnostic request or Gemini parameter error (400). ${err.message}`;
      case 401:
        return 'Authentication required or session expired (401). Sign in again with a verified Google account.';
      case 403:
        return 'Admin authorization denied (403). Your Firebase account is not authorized on the server admin allowlist.';
      case 404:
        return 'Gemini diagnostic is currently disabled or model not found (404). Verify ENABLE_GEMINI_DIAGNOSTIC=true on the server.';
      case 429:
        return 'Rate limit reached (429). Wait about 60 seconds before running the diagnostic again.';
      case 503:
        return `Gemini service unavailable (503). ${err.message}`;
      case 504:
        return 'Server diagnostic call timed out (504). Please retry in a moment.';
      default:
        return `Diagnostic request failed (${err.status}): ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : 'Unable to run Gemini diagnostic.';
}

function formatHttpStatusLabel(prefix: string, status: number): string {
  switch (status) {
    case 200:
      return `${prefix}: 200 OK`;
    case 400:
      return `${prefix}: 400 Invalid`;
    case 403:
      return `${prefix}: 403 Forbidden`;
    case 404:
      return `${prefix}: 404 Not Found`;
    case 429:
      return `${prefix}: 429 Rate Limit`;
    case 503:
      return `${prefix}: 503 Unavailable`;
    case 504:
      return `${prefix}: 504 Timeout`;
    default:
      return `${prefix}: ${status}`;
  }
}

function getHttpStatusBadgeTone(status: number): string {
  if (status >= 200 && status < 300) {
    return 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900/60';
  }
  if (status === 503 || status === 504 || status === 429) {
    return 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900/60';
  }
  return 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/40 dark:border-red-900/60';
}

function pickInitialCatalogSelection(
  catalogModels: CatalogModelInfo[],
  configured?: { primaryModel: string; fallbackModels: string[] }
): string[] {
  const availableIds = new Set(catalogModels.map((m) => m.id));
  const picks: string[] = [];
  const addIfAvailable = (id: string) => {
    if (availableIds.has(id) && !picks.includes(id) && picks.length < MAX_SELECTABLE_MODELS) {
      picks.push(id);
    }
  };

  // Prioritize gemini-3.5-flash and gemini-3.6-flash when present in models.list()
  addIfAvailable('gemini-3.5-flash');
  addIfAvailable('gemini-3.6-flash');

  if (configured) {
    addIfAvailable(configured.primaryModel);
    for (const fb of configured.fallbackModels) {
      addIfAvailable(fb);
    }
  }

  for (const m of catalogModels) {
    if (picks.length >= MAX_SELECTABLE_MODELS) break;
    const lower = m.id.toLowerCase();
    if (
      lower.startsWith('gemini-') &&
      !lower.includes('embedding') &&
      !lower.includes('image') &&
      !lower.includes('tts') &&
      !lower.includes('live') &&
      !lower.includes('audio')
    ) {
      addIfAvailable(m.id);
    }
  }

  return picks;
}

export function GeminiDiagnosticCard() {
  const { user } = useAuth();
  const isUiDisabled = import.meta.env.VITE_DISABLE_GEMINI_DIAGNOSTIC_UI === 'true';

  const [eligibility, setEligibility] = useState<DiagnosticEligibilityResponse | null>(null);
  const [catalog, setCatalog] = useState<GeminiModelCatalogResult | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [modelFilter, setModelFilter] = useState('');
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [report, setReport] = useState<GeminiDiagnosticReport | null>(null);
  const [showListedModels, setShowListedModels] = useState(false);

  const loadDiagnosticStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (isUiDisabled || !user || !user.emailVerified) {
        setEligibility(null);
        setCatalog(null);
        return;
      }

      setLoadingCatalog(true);
      try {
        const res = await apiFetch<DiagnosticEligibilityResponse>(
          '/api/admin/gemini-diagnostic?includeCatalog=1',
          {
            method: 'GET',
            signal,
          }
        );
        if (signal?.aborted) return;

        if (res.enabled && res.authorized) {
          setEligibility(res);
          if (res.catalog) {
            setCatalog(res.catalog);
            const catalogSet = new Set(res.catalog.models.map((m) => m.id));
            setSelectedModels((prev) => {
              const preserved = prev.filter((id) => catalogSet.has(id)).slice(0, MAX_SELECTABLE_MODELS);
              return preserved.length > 0
                ? preserved
                : pickInitialCatalogSelection(res.catalog!.models, res.configured);
            });
          }
        } else {
          setEligibility(null);
          setCatalog(null);
        }
      } catch (err) {
        if (signal?.aborted) return;
        // Fail closed on 401/403/404; only surface transient errors if already eligible
        if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403 || err.status === 404)) {
          setEligibility(null);
          setCatalog(null);
        } else if (eligibility?.authorized) {
          setErrorMsg(formatDiagnosticError(err));
        } else {
          setEligibility(null);
          setCatalog(null);
        }
      } finally {
        if (!signal?.aborted) {
          setLoadingCatalog(false);
        }
      }
    },
    [isUiDisabled, user?.uid, user?.emailVerified, eligibility?.authorized]
  );

  useEffect(() => {
    if (isUiDisabled || !user || !user.emailVerified) {
      setEligibility(null);
      setCatalog(null);
      return;
    }

    const controller = new AbortController();
    void loadDiagnosticStatus(controller.signal);

    return () => {
      controller.abort();
    };
    // Intentionally keyed to signed-in verified user identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUiDisabled, user?.uid, user?.emailVerified]);

  const catalogModels = catalog?.models ?? [];
  const filteredCatalogModels = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    if (!query) return catalogModels;
    return catalogModels.filter(
      (m) =>
        m.id.toLowerCase().includes(query) ||
        (m.displayName && m.displayName.toLowerCase().includes(query))
    );
  }, [catalogModels, modelFilter]);

  const flash35Or36Available = useMemo(
    () =>
      catalogModels
        .map((m) => m.id)
        .filter((id) => id === 'gemini-3.5-flash' || id === 'gemini-3.6-flash'),
    [catalogModels]
  );

  if (isUiDisabled || !eligibility?.enabled || !eligibility?.authorized) {
    return null;
  }

  const toggleModelSelection = (modelId: string) => {
    setSelectedModels((prev) => {
      if (prev.includes(modelId)) {
        return prev.filter((id) => id !== modelId);
      }
      if (prev.length >= MAX_SELECTABLE_MODELS) {
        return prev;
      }
      return [...prev, modelId];
    });
  };

  const handleSelectFlash35And36 = () => {
    if (flash35Or36Available.length === 0) return;
    setSelectedModels(flash35Or36Available.slice(0, MAX_SELECTABLE_MODELS));
  };

  const handleSelectConfigured = () => {
    if (!eligibility.configured) return;
    const availableIds = new Set(catalogModels.map((m) => m.id));
    const configuredListed = [
      eligibility.configured.primaryModel,
      ...eligibility.configured.fallbackModels,
    ].filter((id, idx, arr) => availableIds.has(id) && arr.indexOf(id) === idx);
    setSelectedModels(configuredListed.slice(0, MAX_SELECTABLE_MODELS));
  };

  const handleRunDiagnostic = async () => {
    if (running || selectedModels.length === 0 || selectedModels.length > MAX_SELECTABLE_MODELS) {
      return;
    }
    setRunning(true);
    setErrorMsg(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CLIENT_DIAGNOSTIC_TIMEOUT_MS);

    try {
      const data = await apiFetch<GeminiDiagnosticReport>('/api/admin/gemini-diagnostic', {
        method: 'POST',
        body: JSON.stringify({ models: selectedModels }),
        signal: controller.signal,
      });
      setReport(data);
      if (data.modelsList?.models) {
        setCatalog(data.modelsList);
      }
    } catch (err) {
      setErrorMsg(formatDiagnosticError(err));
    } finally {
      window.clearTimeout(timeoutId);
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-display text-sm font-semibold">
              Gemini Model Availability Diagnostic
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Temporary admin-only diagnostic using your server-side{' '}
            <code className="font-mono">GEMINI_API_KEY</code>. Select up to 4 models from the authenticated{' '}
            <code className="font-mono">models.list()</code> catalog to run single-shot plain-text and structured JSON checks (30s timeout per call, no automatic retries).
          </p>
        </div>
        <StatusText label="Admin Only · Temporary" tone="info" />
      </div>

      {eligibility.configured && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
          Configured models (unchanged): primary{' '}
          <code className="font-mono font-medium">{eligibility.configured.primaryModel}</code>
          {eligibility.configured.fallbackModels.length > 0 && (
            <>
              {' · '}fallback{' '}
              <code className="font-mono font-medium">
                {eligibility.configured.fallbackModels.join(', ')}
              </code>
            </>
          )}
        </div>
      )}

      {/* Authenticated generateContent model catalog selector (max 4) */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Select Models to Test ({selectedModels.length} / {MAX_SELECTABLE_MODELS} selected)
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {catalog?.success
                ? `${catalog.generateContentSupportedCount} generateContent models returned by models.list() (${catalog.latencyMs} ms)`
                : catalog
                ? `Catalog unavailable (${catalog.status} ${catalog.apiStatus})`
                : 'Loading authenticated generateContent catalog...'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {flash35Or36Available.length > 0 && (
              <button
                type="button"
                onClick={handleSelectFlash35And36}
                disabled={running}
                className="rounded border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                Pick {flash35Or36Available.join(' + ')}
              </button>
            )}
            <button
              type="button"
              onClick={handleSelectConfigured}
              disabled={running || catalogModels.length === 0}
              className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Pick Configured
            </button>
            <button
              type="button"
              onClick={() => setSelectedModels([])}
              disabled={running || selectedModels.length === 0}
              className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void loadDiagnosticStatus()}
              disabled={loadingCatalog || running}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-3 w-3 ${loadingCatalog ? 'animate-spin' : ''}`} />
              <span>Refresh Catalog</span>
            </button>
          </div>
        </div>

        {catalog && !catalog.success && (
          <ErrorBanner
            message={`models.list() failed (${catalog.status} ${catalog.apiStatus}): ${
              catalog.errorReason || 'Unable to retrieve authenticated model catalog.'
            }`}
          />
        )}

        {catalogModels.length > 0 && (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                placeholder="Filter generateContent models (e.g. gemini-3.5-flash, gemini-3.6-flash)..."
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div className="max-h-52 overflow-y-auto divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {filteredCatalogModels.length === 0 ? (
                <div className="px-3 py-3 text-center text-xs text-slate-500">
                  No catalog models match &ldquo;{modelFilter}&rdquo;.
                </div>
              ) : (
                filteredCatalogModels.map((model) => {
                  const checked = selectedModels.includes(model.id);
                  const limitReached = !checked && selectedModels.length >= MAX_SELECTABLE_MODELS;
                  const isConfiguredPrimary = eligibility.configured?.primaryModel === model.id;
                  const isConfiguredFallback = eligibility.configured?.fallbackModels.includes(model.id);

                  return (
                    <label
                      key={model.id}
                      className={`flex items-center justify-between gap-3 px-3 py-2 text-xs ${
                        limitReached
                          ? 'cursor-not-allowed opacity-50 bg-slate-50/60 dark:bg-slate-900/40'
                          : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={running || limitReached}
                          onChange={() => toggleModelSelection(model.id)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                        />
                        <div className="min-w-0">
                          <div className="font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
                            {model.id}
                          </div>
                          {model.displayName && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {model.displayName}
                            </div>
                          )}
                        </div>
                      </div>

                      {(isConfiguredPrimary || isConfiguredFallback) && (
                        <span className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {isConfiguredPrimary ? 'Configured Primary' : 'Configured Fallback'}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </>
        )}

        {selectedModels.length > 0 && (
          <div className="text-[11px] text-slate-600 dark:text-slate-300">
            Selected for test:{' '}
            <code className="font-mono font-medium">{selectedModels.join(', ')}</code>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleRunDiagnostic}
          disabled={running || loadingCatalog || selectedModels.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Activity className="h-3.5 w-3.5" />
          )}
          <span>
            {running
              ? `Testing ${selectedModels.length} Selected Model(s)...`
              : `Run Gemini Diagnostic (${selectedModels.length} selected)`}
          </span>
        </button>

        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Disable anytime by removing <code className="font-mono">ENABLE_GEMINI_DIAGNOSTIC</code> on the server.
        </span>
      </div>

      {errorMsg && <ErrorBanner message={errorMsg} />}

      {report && (
        <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
          {!report.modelsList.success && (
            <ErrorBanner
              message={`models.list() failed (${report.modelsList.status} ${report.modelsList.apiStatus}): ${
                report.modelsList.errorReason || 'Unable to retrieve authenticated model catalog.'
              }`}
            />
          )}

          {report.summary.skippedUnlistedModels && report.summary.skippedUnlistedModels.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              Skipped models absent from authenticated <code className="font-mono">models.list()</code> catalog:{' '}
              <code className="font-mono font-medium">
                {report.summary.skippedUnlistedModels.join(', ')}
              </code>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">models.list()</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  HTTP {report.modelsList.status}
                </span>
                <span className="font-mono text-slate-500">{report.modelsList.latencyMs} ms</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {report.modelsList.generateContentSupportedCount} generateContent models
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Working Structured JSON</div>
              <div className="mt-1 font-semibold text-emerald-700 dark:text-emerald-400">
                {report.summary.workingStructuredJsonModels.length > 0
                  ? report.summary.workingStructuredJsonModels.join(', ')
                  : 'None'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Returned 503</div>
              <div className="mt-1 font-semibold text-amber-700 dark:text-amber-400">
                {report.summary.unavailable503Models.length > 0
                  ? report.summary.unavailable503Models.join(', ')
                  : 'None'}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Model</th>
                  <th className="px-3 py-2.5 font-medium">HTTP Status</th>
                  <th className="px-3 py-2.5 font-medium">Plain Text (&ldquo;OK.&rdquo;)</th>
                  <th className="px-3 py-2.5 font-medium">Structured JSON</th>
                  <th className="px-3 py-2.5 font-medium text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {report.modelTests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500 dark:text-slate-400">
                      No catalog-verified <code className="font-mono">generateContent</code> models were tested.
                    </td>
                  </tr>
                ) : (
                  report.modelTests.map((item) => {
                    const textLatency = `${item.textTest.latencyMs} ms`;
                    const jsonLatency = item.structuredJsonTest
                      ? `${item.structuredJsonTest.latencyMs} ms`
                      : '—';

                    return (
                      <tr key={item.model} className="align-top">
                        <td className="px-3 py-2.5">
                          <div className="font-mono font-medium text-slate-900 dark:text-slate-100">
                            {item.model}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            Verified in models.list()
                          </div>
                        </td>

                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <span
                              className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 font-mono text-[11px] ${getHttpStatusBadgeTone(
                                item.textTest.status
                              )}`}
                            >
                              {formatHttpStatusLabel('Text', item.textTest.status)}
                            </span>
                            {item.structuredJsonTest && (
                              <span
                                className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 font-mono text-[11px] ${getHttpStatusBadgeTone(
                                  item.structuredJsonTest.status
                                )}`}
                              >
                                {formatHttpStatusLabel('JSON', item.structuredJsonTest.status)}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2.5">
                          <div className="flex items-start gap-1.5">
                            {item.textTest.success ? (
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                            )}
                            <div>
                              <div className="font-medium">
                                {item.textTest.success ? 'Success' : item.textTest.apiStatus}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 break-words max-w-[200px]">
                                {item.textTest.success
                                  ? item.textTest.outputPreview || 'OK'
                                  : item.textTest.errorReason || 'Failed'}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-2.5">
                          {item.structuredJsonTest ? (
                            <div className="flex items-start gap-1.5">
                              {item.structuredJsonTest.success ? (
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                              )}
                              <div>
                                <div className="font-medium">
                                  {item.structuredJsonTest.success
                                    ? 'Valid JSON'
                                    : item.structuredJsonTest.apiStatus}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 break-words max-w-[200px]">
                                  {item.structuredJsonTest.success
                                    ? item.structuredJsonTest.outputPreview
                                    : item.structuredJsonTest.errorReason || 'Invalid or failed'}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">Skipped (budget limit)</span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap text-slate-600 dark:text-slate-300">
                          <div>{textLatency}</div>
                          <div className="text-[11px] text-slate-500">{jsonLatency}</div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {report.modelsList.generateContentModels.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowListedModels((prev) => !prev)}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                {showListedModels ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span>
                  {showListedModels ? 'Hide' : 'Show'} all{' '}
                  {report.modelsList.generateContentModels.length} generateContent models from{' '}
                  models.list()
                </span>
              </button>

              {showListedModels && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                  {report.modelsList.generateContentModels.join(', ')}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Executed at {new Date(report.executedAt).toLocaleString()} · {report.cleanupReminder}
          </p>
        </div>
      )}
    </div>
  );
}
