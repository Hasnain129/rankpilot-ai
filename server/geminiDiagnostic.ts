import { Type, type GoogleGenAI, type Model } from '@google/genai';
import type express from 'express';
import { classifyGeminiError, getConfiguredGeminiModels, getGeminiClient } from './gemini.ts';

const MAX_LIST_PAGES = 3;
const MAX_LIST_MODELS = 120;
const MAX_TEST_MODELS = 4;
const PER_CALL_TIMEOUT_MS = 8_000;
const TOTAL_DIAGNOSTIC_BUDGET_MS = 40_000;

const SAFE_MODEL_ID_RE = /^[a-zA-Z0-9._-]{2,80}$/;

const NON_TEXT_MODEL_PATTERNS = [
  'embedding',
  'imagen',
  'veo',
  'lyria',
  'tts',
  'live',
  'transcribe',
  'image',
  'audio',
  'robotics',
  'computer-use',
  'genie',
  'decision',
  'deep-research',
  'aqa',
];

export interface DiagnosticCallResult {
  success: boolean;
  status: number;
  apiStatus: string;
  latencyMs: number;
  outputPreview?: string;
  validJson?: boolean;
  errorReason?: string;
}

export interface DiagnosticModelResult {
  model: string;
  inModelsList: boolean;
  textTest: DiagnosticCallResult;
  structuredJsonTest: DiagnosticCallResult | null;
}

export interface GeminiDiagnosticReport {
  diagnosticEnabled: true;
  executedAt: string;
  configured: {
    primaryModel: string;
    fallbackModels: string[];
    unchanged: true;
  };
  limits: {
    maxModelsTested: number;
    maxCallsPerModel: number;
    perCallTimeoutMs: number;
    totalBudgetMs: number;
    modelsListCap: number;
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

function parseCsvSet(raw: string | undefined, lowercase = false): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((item) => (lowercase ? item.trim().toLowerCase() : item.trim()))
      .filter((item) => item.length > 0)
  );
}

export function isDiagnosticEnabled(): boolean {
  return process.env.ENABLE_GEMINI_DIAGNOSTIC?.trim().toLowerCase() === 'true';
}

export function requireDiagnosticAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const auth = req.firebaseAuth;
  if (!auth || !auth.emailVerified) {
    res.status(401).json({
      error: 'Verified Firebase authentication is required.',
    });
    return;
  }

  const allowedEmails = parseCsvSet(process.env.GEMINI_DIAGNOSTIC_ADMIN_EMAILS, true);
  const allowedUids = parseCsvSet(process.env.GEMINI_DIAGNOSTIC_ADMIN_UIDS, false);

  if (allowedEmails.size === 0 && allowedUids.size === 0) {
    res.status(403).json({
      error:
        'Diagnostic admin authorization is not configured. Set GEMINI_DIAGNOSTIC_ADMIN_EMAILS or GEMINI_DIAGNOSTIC_ADMIN_UIDS on the server.',
    });
    return;
  }

  const normalizedEmail = auth.email.trim().toLowerCase();
  const isAuthorizedAdmin =
    (normalizedEmail.length > 0 && allowedEmails.has(normalizedEmail)) ||
    allowedUids.has(auth.uid);

  if (!isAuthorizedAdmin) {
    res.status(403).json({
      error: 'Forbidden: explicit admin authorization is required to run this diagnostic.',
    });
    return;
  }

  if (!isDiagnosticEnabled()) {
    res.status(404).json({
      error:
        'Gemini diagnostic endpoint is disabled. Set ENABLE_GEMINI_DIAGNOSTIC=true temporarily during testing, then disable or remove it.',
    });
    return;
  }

  next();
}

function normalizeModelId(rawName: string | undefined): string {
  return String(rawName || '')
    .trim()
    .replace(/^models\//, '');
}

function isLikelyTextGenerationModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (!lower.startsWith('gemini-')) return false;
  return !NON_TEXT_MODEL_PATTERNS.some((pat) => lower.includes(pat));
}

function sanitizeDiagnosticError(err: unknown): {
  status: number;
  apiStatus: string;
  errorReason: string;
} {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    /timed?\s*out|aborted/i.test(msg)
  ) {
    return {
      status: 504,
      apiStatus: 'DEADLINE_EXCEEDED',
      errorReason: `Timed out after ${PER_CALL_TIMEOUT_MS}ms.`,
    };
  }

  const classified = classifyGeminiError(err);
  const safeReason = classified.message
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED]')
    .replace(/AQ\.[0-9A-Za-z_-]{10,}/g, '[REDACTED]')
    .slice(0, 180);

  return {
    status: classified.status,
    apiStatus: classified.apiStatus,
    errorReason: safeReason,
  };
}

function selectCandidateModels(
  configuredPrimary: string,
  configuredFallbacks: string[],
  listedGenerateContentModels: string[],
  requestedModels?: string[]
): string[] {
  if (Array.isArray(requestedModels) && requestedModels.length > 0) {
    const validated = requestedModels
      .map((m) => normalizeModelId(m))
      .filter((m) => SAFE_MODEL_ID_RE.test(m));
    return Array.from(new Set(validated)).slice(0, MAX_TEST_MODELS);
  }

  const candidates: string[] = [];
  const push = (id: string) => {
    const normalized = normalizeModelId(id);
    if (normalized && SAFE_MODEL_ID_RE.test(normalized) && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  push(configuredPrimary);
  for (const fb of configuredFallbacks) {
    push(fb);
  }

  // Prefer stable/preview flash/lite/pro text models from models.list()
  const rankedListed = listedGenerateContentModels
    .filter((id) => isLikelyTextGenerationModel(id))
    .sort((a, b) => {
      const score = (id: string) => {
        if (id.includes('flash-lite')) return 1;
        if (id.includes('flash')) return 2;
        if (id.includes('hydrogen')) return 3;
        if (id.includes('pro')) return 4;
        return 5;
      };
      return score(a) - score(b) || a.localeCompare(b);
    });

  for (const listedId of rankedListed) {
    if (candidates.length >= MAX_TEST_MODELS) break;
    push(listedId);
  }

  return candidates.slice(0, MAX_TEST_MODELS);
}

export interface RunDiagnosticOptions {
  client?: GoogleGenAI;
  requestedModels?: string[];
  perCallTimeoutMs?: number;
  totalBudgetMs?: number;
}

export async function runGeminiAvailabilityDiagnostic(
  options: RunDiagnosticOptions = {}
): Promise<GeminiDiagnosticReport> {
  const perCallTimeoutMs = Math.min(
    10_000,
    Math.max(1_000, options.perCallTimeoutMs ?? PER_CALL_TIMEOUT_MS)
  );
  const totalBudgetMs = Math.min(
    45_000,
    Math.max(5_000, options.totalBudgetMs ?? TOTAL_DIAGNOSTIC_BUDGET_MS)
  );
  const startedAt = Date.now();
  const ai = options.client ?? getGeminiClient();
  const configured = getConfiguredGeminiModels();

  // Step 1: Call models.list() to discover models supporting generateContent
  const listStart = Date.now();
  let modelsListSuccess = false;
  let modelsListStatus = 200;
  let modelsListApiStatus = 'OK';
  let modelsListErrorReason: string | undefined;
  const listedModels: Model[] = [];

  try {
    const pager = await ai.models.list({
      config: {
        pageSize: 100,
        queryBase: true,
        abortSignal: AbortSignal.timeout(perCallTimeoutMs),
        httpOptions: { timeout: perCallTimeoutMs },
      },
    });

    for await (const model of pager) {
      listedModels.push(model);
      if (listedModels.length >= MAX_LIST_MODELS) {
        break;
      }
      if (Date.now() - listStart > perCallTimeoutMs * MAX_LIST_PAGES) {
        break;
      }
    }
    modelsListSuccess = true;
  } catch (err) {
    const sanitized = sanitizeDiagnosticError(err);
    modelsListSuccess = false;
    modelsListStatus = sanitized.status;
    modelsListApiStatus = sanitized.apiStatus;
    modelsListErrorReason = sanitized.errorReason;
  }
  const modelsListLatencyMs = Date.now() - listStart;

  const generateContentModels = Array.from(
    new Set(
      listedModels
        .filter((m) => Array.isArray(m.supportedActions) && m.supportedActions.includes('generateContent'))
        .map((m) => normalizeModelId(m.name))
        .filter((id) => id.length > 0)
    )
  ).sort();

  const listedSet = new Set(generateContentModels);
  const modelsToTest = selectCandidateModels(
    configured.primaryModel,
    configured.fallbackModels,
    generateContentModels,
    options.requestedModels
  );

  // Step 2: Run bounded minimal text + structured JSON checks on selected models
  const modelTests: DiagnosticModelResult[] = [];
  let budgetExhausted = false;

  for (const model of modelsToTest) {
    if (Date.now() - startedAt > totalBudgetMs - perCallTimeoutMs) {
      budgetExhausted = true;
      break;
    }

    // 2a. Plain text check: "Return the word OK."
    const textStart = Date.now();
    let textTest: DiagnosticCallResult;
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: 'Return the word OK.',
        config: {
          abortSignal: AbortSignal.timeout(perCallTimeoutMs),
          httpOptions: { timeout: perCallTimeoutMs },
        },
      });
      const text = String(resp.text || '').trim();
      textTest = {
        success: text.length > 0,
        status: 200,
        apiStatus: 'OK',
        latencyMs: Date.now() - textStart,
        outputPreview: text.slice(0, 40) || '(empty)',
      };
    } catch (err) {
      const sanitized = sanitizeDiagnosticError(err);
      textTest = {
        success: false,
        status: sanitized.status,
        apiStatus: sanitized.apiStatus,
        latencyMs: Date.now() - textStart,
        errorReason: sanitized.errorReason,
      };
    }

    // 2b. Structured JSON check: responseMimeType: "application/json"
    let structuredJsonTest: DiagnosticCallResult | null = null;
    if (Date.now() - startedAt <= totalBudgetMs - Math.min(3_000, perCallTimeoutMs)) {
      const jsonStart = Date.now();
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: 'Return a JSON object with field ok set to true.',
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                ok: { type: Type.BOOLEAN },
              },
              required: ['ok'],
            },
            abortSignal: AbortSignal.timeout(perCallTimeoutMs),
            httpOptions: { timeout: perCallTimeoutMs },
          },
        });
        const rawText = String(resp.text || '').trim();
        let validJson = false;
        try {
          const parsed = JSON.parse(rawText) as { ok?: unknown };
          validJson = typeof parsed === 'object' && parsed !== null && parsed.ok === true;
        } catch {
          validJson = false;
        }
        structuredJsonTest = {
          success: validJson,
          status: 200,
          apiStatus: 'OK',
          latencyMs: Date.now() - jsonStart,
          validJson,
          outputPreview: rawText.slice(0, 60) || '(empty)',
        };
      } catch (err) {
        const sanitized = sanitizeDiagnosticError(err);
        structuredJsonTest = {
          success: false,
          status: sanitized.status,
          apiStatus: sanitized.apiStatus,
          latencyMs: Date.now() - jsonStart,
          validJson: false,
          errorReason: sanitized.errorReason,
        };
      }
    } else {
      budgetExhausted = true;
    }

    modelTests.push({
      model,
      inModelsList: listedSet.has(model),
      textTest,
      structuredJsonTest,
    });
  }

  const workingTextModels = modelTests.filter((m) => m.textTest.success).map((m) => m.model);
  const workingStructuredJsonModels = modelTests
    .filter((m) => m.structuredJsonTest?.success)
    .map((m) => m.model);
  const unavailable503Models = modelTests
    .filter(
      (m) => m.textTest.status === 503 || m.structuredJsonTest?.status === 503
    )
    .map((m) => m.model);
  const otherFailedModels = modelTests
    .filter(
      (m) =>
        !m.textTest.success &&
        m.textTest.status !== 503
    )
    .map((m) => ({
      model: m.model,
      status: m.textTest.status,
      apiStatus: m.textTest.apiStatus,
    }));

  return {
    diagnosticEnabled: true,
    executedAt: new Date().toISOString(),
    configured: {
      primaryModel: configured.primaryModel,
      fallbackModels: configured.fallbackModels,
      unchanged: true,
    },
    limits: {
      maxModelsTested: MAX_TEST_MODELS,
      maxCallsPerModel: 2,
      perCallTimeoutMs,
      totalBudgetMs,
      modelsListCap: MAX_LIST_MODELS,
    },
    modelsList: {
      success: modelsListSuccess,
      status: modelsListStatus,
      apiStatus: modelsListApiStatus,
      latencyMs: modelsListLatencyMs,
      totalListed: listedModels.length,
      generateContentSupportedCount: generateContentModels.length,
      generateContentModels,
      ...(modelsListErrorReason ? { errorReason: modelsListErrorReason } : {}),
    },
    modelTests,
    summary: {
      workingTextModels,
      workingStructuredJsonModels,
      unavailable503Models,
      otherFailedModels,
      budgetExhausted,
    },
    cleanupReminder:
      'Temporary diagnostic endpoint: unset ENABLE_GEMINI_DIAGNOSTIC (or remove /api/admin/gemini-diagnostic) once testing is finished.',
  };
}
