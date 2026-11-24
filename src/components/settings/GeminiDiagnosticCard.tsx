import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, ChevronDown, ChevronUp, Loader2, XCircle } from 'lucide-react';
import { ApiRequestError, apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import { ErrorBanner, StatusText } from '../ui/DataState';

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
  modelsList: {
    success: boolean;
    status: number;
    apiStatus: string;
    latencyMs: number;
    totalListed: number;
    generateContentSupportedCount: number;
    generateContentModels: string[];
    errorReason?: string;
  };
  modelTests: DiagnosticModelResult[];
  summary: {
    workingTextModels: string[];
    workingStructuredJsonModels: string[];
    unavailable503Models: string[];
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
}

const CLIENT_DIAGNOSTIC_TIMEOUT_MS = 48_000;

function formatDiagnosticError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Diagnostic request timed out after 48 seconds before the server finished. Please try again.';
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return 'Diagnostic request timed out before completing. Please try again.';
  }
  if (err instanceof ApiRequestError) {
    switch (err.status) {
      case 401:
        return 'Authentication required or session expired (401). Sign in again with a verified Google account.';
      case 403:
        return 'Admin authorization denied (403). Your Firebase account is not authorized on the server admin allowlist.';
      case 404:
        return 'Gemini diagnostic is currently disabled on the server (404). Set ENABLE_GEMINI_DIAGNOSTIC=true temporarily to enable it.';
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

function getHttpStatusBadgeTone(status: number): string {
  if (status >= 200 && status < 300) {
    return 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900/60';
  }
  if (status === 503 || status === 504 || status === 429) {
    return 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900/60';
  }
  return 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/40 dark:border-red-900/60';
}

export function GeminiDiagnosticCard() {
  const { user } = useAuth();
  const isUiDisabled = import.meta.env.VITE_DISABLE_GEMINI_DIAGNOSTIC_UI === 'true';

  const [eligibility, setEligibility] = useState<DiagnosticEligibilityResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [report, setReport] = useState<GeminiDiagnosticReport | null>(null);
  const [showListedModels, setShowListedModels] = useState(false);

  useEffect(() => {
    if (isUiDisabled || !user || !user.emailVerified) {
      setEligibility(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    apiFetch<DiagnosticEligibilityResponse>('/api/admin/gemini-diagnostic', {
      method: 'GET',
      signal: controller.signal,
    })
      .then((res) => {
        if (!active) return;
        if (res.enabled && res.authorized) {
          setEligibility(res);
        } else {
          setEligibility(null);
        }
      })
      .catch(() => {
        if (!active) return;
        // Fail closed: keep button hidden for non-admins or when disabled.
        setEligibility(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isUiDisabled, user?.uid, user?.emailVerified]);

  if (isUiDisabled || !eligibility?.enabled || !eligibility?.authorized) {
    return null;
  }

  const handleRunDiagnostic = async () => {
    if (running) return;
    setRunning(true);
    setErrorMsg(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CLIENT_DIAGNOSTIC_TIMEOUT_MS);

    try {
      const data = await apiFetch<GeminiDiagnosticReport>('/api/admin/gemini-diagnostic', {
        method: 'POST',
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      setReport(data);
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
            <code className="font-mono">GEMINI_API_KEY</code>. Calls{' '}
            <code className="font-mono">models.list()</code> and runs minimal text and structured JSON checks (max 4 models).
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleRunDiagnostic}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Activity className="h-3.5 w-3.5" />
          )}
          <span>{running ? 'Running Gemini Diagnostic...' : 'Run Gemini Diagnostic'}</span>
        </button>

        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Disable anytime by removing <code className="font-mono">ENABLE_GEMINI_DIAGNOSTIC</code> on the server.
        </span>
      </div>

      {errorMsg && <ErrorBanner message={errorMsg} />}

      {report && (
        <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
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
                {report.modelTests.map((item) => {
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
                          {item.inModelsList ? 'In models.list()' : 'Configured (not listed)'}
                        </div>
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 font-mono text-[11px] ${getHttpStatusBadgeTone(
                              item.textTest.status
                            )}`}
                          >
                            Text: {item.textTest.status}
                          </span>
                          {item.structuredJsonTest && (
                            <span
                              className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 font-mono text-[11px] ${getHttpStatusBadgeTone(
                                item.structuredJsonTest.status
                              )}`}
                            >
                              JSON: {item.structuredJsonTest.status}
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
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 break-words max-w-[180px]">
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
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 break-words max-w-[180px]">
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
                })}
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
