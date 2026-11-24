import { GenerateContentParameters, GenerateContentResponse, GoogleGenAI, ThinkingLevel } from '@google/genai';

const MIN_GEMINI_DEADLINE_MS = 10_000;
const DEFAULT_PER_CALL_TIMEOUT_MS = 22_000;

export function isGemini3Or4Model(modelId: string): boolean {
  const lower = String(modelId || '').trim().toLowerCase().replace(/^models\//, '');
  if (!/^gemini-(?:3|4)(?:[.\-]|$)/.test(lower)) return false;
  return !['-tts', '-live', '-image', '-transcribe', '-audio'].some((suffix) =>
    lower.includes(suffix)
  );
}

export const DEFAULT_GEMINI_PRIMARY_MODEL = 'gemini-4-hydrogen';
export const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-3.1-flash-lite'] as const;

export interface ConfiguredGeminiModels {
  primaryModel: string;
  fallbackModels: string[];
}

export function getConfiguredGeminiModels(): ConfiguredGeminiModels {
  const primaryModel =
    process.env.GEMINI_PRIMARY_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    DEFAULT_GEMINI_PRIMARY_MODEL;

  const rawFallback =
    process.env.GEMINI_FALLBACK_MODELS ?? process.env.GEMINI_FALLBACK_MODEL;

  let fallbackModels: string[];
  if (rawFallback !== undefined) {
    const trimmed = rawFallback.trim();
    if (!trimmed || trimmed.toLowerCase() === 'none') {
      fallbackModels = [];
    } else {
      fallbackModels = trimmed
        .split(',')
        .map((m) => m.trim())
        .filter((m) => m.length > 0 && m !== primaryModel);
    }
  } else {
    fallbackModels = DEFAULT_GEMINI_FALLBACK_MODELS.filter((m) => m !== primaryModel);
  }

  return {
    primaryModel,
    fallbackModels: Array.from(new Set(fallbackModels)),
  };
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiClassifiedError({
      status: 500,
      apiStatus: 'FAILED_PRECONDITION',
      message: 'GEMINI_API_KEY is not configured on the server.',
      retryable: false,
      canFallback: false,
      isQuotaExhausted: false,
    });
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface ClassifiedGeminiErrorInfo {
  status: number;
  apiStatus: string;
  message: string;
  retryable: boolean;
  canFallback: boolean;
  isQuotaExhausted: boolean;
  retryAfterMs?: number;
}

export interface GeminiAttemptSummary {
  model: string;
  status: number;
  apiStatus: string;
  attempts: number;
  detail?: string;
}

export class GeminiClassifiedError extends Error {
  status: number;
  apiStatus: string;
  retryable: boolean;
  canFallback: boolean;
  isQuotaExhausted: boolean;
  retryAfterMs?: number;
  model?: string;
  retryCount: number;
  fallbackUsed: boolean;
  attemptsSummary: GeminiAttemptSummary[];

  constructor(
    info: ClassifiedGeminiErrorInfo & {
      model?: string;
      retryCount?: number;
      fallbackUsed?: boolean;
      attemptsSummary?: GeminiAttemptSummary[];
    }
  ) {
    super(info.message);
    this.name = 'GeminiClassifiedError';
    this.status = info.status;
    this.apiStatus = info.apiStatus;
    this.retryable = info.retryable;
    this.canFallback = info.canFallback;
    this.isQuotaExhausted = info.isQuotaExhausted;
    this.retryAfterMs = info.retryAfterMs;
    this.model = info.model;
    this.retryCount = info.retryCount ?? 0;
    this.fallbackUsed = info.fallbackUsed ?? false;
    this.attemptsSummary = info.attemptsSummary ?? [];
  }
}

function parseRetryAfterHeader(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const targetTs = Date.parse(raw);
  if (Number.isFinite(targetTs)) {
    return Math.max(0, targetTs - Date.now());
  }
  return undefined;
}

function parseDurationToMs(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)s$/i);
  if (!match) return undefined;
  const secs = Number(match[1]);
  return Number.isFinite(secs) && secs >= 0 ? Math.round(secs * 1000) : undefined;
}

function extractRetryAfterFromError(
  err: unknown,
  parsedDetails: unknown,
  detailMessage: string
): number | undefined {
  if (err && typeof err === 'object') {
    const obj = err as {
      retryAfter?: unknown;
      headers?: { get?: (name: string) => string | null } | Record<string, unknown>;
      response?: { headers?: { get?: (name: string) => string | null } | Record<string, unknown> };
    };
    const direct = parseRetryAfterHeader(obj.retryAfter);
    if (direct !== undefined) return direct;

    for (const hdrs of [obj.headers, obj.response?.headers]) {
      if (!hdrs) continue;
      if (typeof (hdrs as { get?: unknown }).get === 'function') {
        const val = (hdrs as { get: (n: string) => string | null }).get('retry-after');
        const parsed = parseRetryAfterHeader(val);
        if (parsed !== undefined) return parsed;
      } else if (typeof hdrs === 'object') {
        const rec = hdrs as Record<string, unknown>;
        const val = rec['retry-after'] ?? rec['Retry-After'];
        const parsed = parseRetryAfterHeader(val);
        if (parsed !== undefined) return parsed;
      }
    }
  }

  if (Array.isArray(parsedDetails)) {
    for (const detail of parsedDetails) {
      if (detail && typeof detail === 'object') {
        const delayMs = parseDurationToMs((detail as { retryDelay?: unknown }).retryDelay);
        if (delayMs !== undefined) return delayMs;
      }
    }
  }

  const msgMatch = detailMessage.match(/retry(?:\s+after|\s+in)?\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)\b/i);
  if (msgMatch) {
    const secs = Number(msgMatch[1]);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.round(secs * 1000);
    }
  }

  return undefined;
}

export function classifyGeminiError(err: unknown): ClassifiedGeminiErrorInfo {
  if (err instanceof GeminiClassifiedError) {
    return {
      status: err.status,
      apiStatus: err.apiStatus,
      message: err.message,
      retryable: err.retryable,
      canFallback: err.canFallback,
      isQuotaExhausted: err.isQuotaExhausted,
      retryAfterMs: err.retryAfterMs,
    };
  }

  const errName = err instanceof Error ? err.name : '';
  const rawMsg = err instanceof Error ? err.message : String(err);
  if (
    errName === 'TimeoutError' ||
    errName === 'AbortError' ||
    /timed?\s*out|deadline_exceeded|aborted/i.test(rawMsg)
  ) {
    return {
      status: 504,
      apiStatus: 'DEADLINE_EXCEEDED',
      message:
        'Gemini AI request timed out before completing (504). Please try again shortly.',
      retryable: true,
      canFallback: true,
      isQuotaExhausted: false,
    };
  }

  let status =
    err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number'
      ? Number((err as { status: number }).status)
      : 0;
  let apiStatus = '';
  let detailMessage = rawMsg;
  let parsedDetails: unknown = undefined;

  try {
    const parsed = JSON.parse(rawMsg) as {
      error?: {
        code?: number;
        status?: string;
        message?: string;
        details?: unknown;
      };
    };
    if (parsed?.error) {
      if (!status && typeof parsed.error.code === 'number') {
        status = parsed.error.code;
      }
      if (typeof parsed.error.status === 'string') {
        apiStatus = parsed.error.status;
      }
      if (typeof parsed.error.message === 'string' && parsed.error.message.trim()) {
        detailMessage = parsed.error.message.trim();
      }
      parsedDetails = parsed.error.details;
    }
  } catch {
    // Non-JSON error message; inspect string hints below.
  }

  const lower = `${apiStatus} ${detailMessage} ${rawMsg}`.toLowerCase();

  if (status < 400 || status >= 600) {
    if (
      lower.includes('503') ||
      lower.includes('unavailable') ||
      lower.includes('high demand') ||
      lower.includes('overloaded')
    ) {
      status = 503;
    } else if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('rate limit')) {
      status = 429;
    } else if (lower.includes('403') || lower.includes('permission_denied')) {
      status = 403;
    } else if (lower.includes('404') || lower.includes('not_found') || lower.includes('is not found')) {
      status = 404;
    } else if (lower.includes('401') || lower.includes('unauthenticated')) {
      status = 401;
    } else if (lower.includes('400') || lower.includes('api_key_invalid') || lower.includes('invalid_argument')) {
      status = 400;
    } else {
      status = 500;
    }
  }

  if (!apiStatus) {
    if (status === 503) apiStatus = 'UNAVAILABLE';
    else if (status === 429) apiStatus = 'RESOURCE_EXHAUSTED';
    else if (status === 403) apiStatus = 'PERMISSION_DENIED';
    else if (status === 404) apiStatus = 'NOT_FOUND';
    else if (status === 401) apiStatus = 'UNAUTHENTICATED';
    else if (status === 400) apiStatus = 'INVALID_ARGUMENT';
    else apiStatus = 'INTERNAL';
  }

  const retryAfterMs = extractRetryAfterFromError(err, parsedDetails, detailMessage);

  if (status === 503 || status === 502) {
    const cleanUpstreamHint = detailMessage
      .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .trim()
      .slice(0, 140);
    return {
      status: 503,
      apiStatus: apiStatus || 'UNAVAILABLE',
      message: cleanUpstreamHint
        ? `Gemini AI model is temporarily experiencing high demand (503: ${cleanUpstreamHint}). Automatic retries and fallback could not complete right now.`
        : 'Gemini AI model is temporarily experiencing high demand (503). Automatic retries and fallback could not complete right now—please try again in a moment.',
      retryable: true,
      canFallback: true,
      isQuotaExhausted: false,
      retryAfterMs,
    };
  }

  if (status === 429) {
    let hasDailyOrZeroQuota =
      lower.includes('exceeded your current quota') ||
      lower.includes('quota exhausted') ||
      lower.includes('daily') ||
      lower.includes('per day') ||
      lower.includes('billing') ||
      lower.includes('check your plan') ||
      lower.includes('insufficient quota') ||
      lower.includes('limit: 0');

    if (Array.isArray(parsedDetails)) {
      for (const detail of parsedDetails) {
        if (!detail || typeof detail !== 'object') continue;
        const violations = (detail as { violations?: unknown }).violations;
        if (!Array.isArray(violations)) continue;
        for (const v of violations) {
          if (!v || typeof v !== 'object') continue;
          const quotaId = String((v as { quotaId?: unknown }).quotaId || '').toLowerCase();
          const quotaValue = String((v as { quotaValue?: unknown }).quotaValue ?? '');
          if (quotaId.includes('perday') || quotaId.includes('daily') || quotaValue === '0') {
            hasDailyOrZeroQuota = true;
          }
        }
      }
    }

    const isProjectBillingSuspension =
      lower.includes('billing account') || lower.includes('spending cap');

    if (hasDailyOrZeroQuota) {
      return {
        status: 429,
        apiStatus: 'RESOURCE_EXHAUSTED',
        message:
          'Gemini API quota exhausted (429). Please check your Gemini API plan quota or billing limits.',
        retryable: false,
        canFallback: !isProjectBillingSuspension,
        isQuotaExhausted: true,
        retryAfterMs,
      };
    }

    const waitHint =
      retryAfterMs && retryAfterMs > 0
        ? ` about ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s`
        : ' briefly';

    return {
      status: 429,
      apiStatus: 'RESOURCE_EXHAUSTED',
      message: `Gemini API rate limit reached (429). Please wait${waitHint} and try again.`,
      retryable: true,
      canFallback: true,
      isQuotaExhausted: false,
      retryAfterMs,
    };
  }

  if (status === 403) {
    return {
      status: 403,
      apiStatus: 'PERMISSION_DENIED',
      message:
        'Gemini API model access or permission denied (403). Verify that GEMINI_API_KEY is valid and permitted for the configured model.',
      retryable: false,
      canFallback: false,
      isQuotaExhausted: false,
    };
  }

  if (status === 404) {
    return {
      status: 404,
      apiStatus: 'NOT_FOUND',
      message:
        'Configured Gemini model is unavailable or unsupported (404). Verify GEMINI_MODEL and GEMINI_FALLBACK_MODELS.',
      retryable: false,
      canFallback: true,
      isQuotaExhausted: false,
    };
  }

  if (status === 400 || status === 401) {
    const isKeyInvalid =
      lower.includes('api key') || lower.includes('api_key_invalid') || status === 401;
    return {
      status,
      apiStatus: apiStatus || (status === 401 ? 'UNAUTHENTICATED' : 'INVALID_ARGUMENT'),
      message: isKeyInvalid
        ? `Gemini API key was rejected (${status}). Verify GEMINI_API_KEY configuration on the server.`
        : `Gemini AI request was rejected (${status}): ${detailMessage.slice(0, 220)}`,
      retryable: false,
      canFallback: false,
      isQuotaExhausted: false,
    };
  }

  return {
    status: 500,
    apiStatus: apiStatus || 'INTERNAL',
    message: 'Unexpected backend error while communicating with Gemini AI. Please try again.',
    retryable: false,
    canFallback: false,
    isQuotaExhausted: false,
  };
}

export function extractGeminiError(err: unknown): {
  status: number;
  message: string;
  retryAfterSeconds?: number;
  attemptsSummary?: GeminiAttemptSummary[];
} {
  const info = classifyGeminiError(err);
  const retryAfterSeconds =
    info.retryAfterMs && info.retryAfterMs > 0
      ? Math.max(1, Math.ceil(info.retryAfterMs / 1000))
      : undefined;
  const attemptsSummary =
    err instanceof GeminiClassifiedError && err.attemptsSummary.length > 0
      ? err.attemptsSummary
      : undefined;
  return {
    status: info.status,
    message: info.message,
    retryAfterSeconds,
    attemptsSummary,
  };
}

export interface GeminiGenerateOptions {
  operation: string;
  contents: GenerateContentParameters['contents'];
  config?: GenerateContentParameters['config'];
  primaryModel?: string;
  fallbackModels?: string[];
  maxPrimaryAttempts?: number;
  maxFallbackAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetryAfterWaitMs?: number;
  perCallTimeoutMs?: number;
  totalBudgetMs?: number;
  preferLowThinking?: boolean;
  client?: GoogleGenAI;
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
}

export interface GeminiGenerateResult {
  response: GenerateContentResponse;
  modelUsed: string;
  retryCount: number;
  fallbackUsed: boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseAndValidateGeminiJson<T>(
  rawText: string | undefined,
  validator: (parsed: Record<string, unknown>) => T
): T {
  const trimmed = String(rawText || '').trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!stripped) {
    throw new GeminiClassifiedError({
      status: 502,
      apiStatus: 'INVALID_RESPONSE',
      message: 'Gemini AI returned an empty response instead of valid JSON.',
      retryable: true,
      canFallback: true,
      isQuotaExhausted: false,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new GeminiClassifiedError({
      status: 502,
      apiStatus: 'INVALID_RESPONSE',
      message: 'Gemini AI returned malformed JSON output.',
      retryable: true,
      canFallback: true,
      isQuotaExhausted: false,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GeminiClassifiedError({
      status: 502,
      apiStatus: 'INVALID_RESPONSE',
      message: 'Gemini AI returned an unexpected JSON structure.',
      retryable: true,
      canFallback: true,
      isQuotaExhausted: false,
    });
  }

  return validator(parsed as Record<string, unknown>);
}

export async function generateGeminiContentWithFallback(
  options: GeminiGenerateOptions
): Promise<GeminiGenerateResult> {
  const configured = getConfiguredGeminiModels();
  const primaryModel = options.primaryModel?.trim() || configured.primaryModel;
  const fallbackModels = (
    options.fallbackModels
      ? options.fallbackModels.map((m) => m.trim()).filter((m) => m.length > 0 && m !== primaryModel)
      : configured.fallbackModels
  );

  const modelsToTry = [primaryModel, ...Array.from(new Set(fallbackModels))];
  const hasFallbacks = modelsToTry.length > 1;
  const maxPrimaryAttempts = Math.max(
    1,
    Math.min(4, options.maxPrimaryAttempts ?? (hasFallbacks ? 2 : 3))
  );
  const maxFallbackAttempts = Math.max(1, Math.min(3, options.maxFallbackAttempts ?? 2));
  const baseDelayMs = Math.max(100, options.baseDelayMs ?? 600);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 6000);
  const maxRetryAfterWaitMs = Math.max(500, options.maxRetryAfterWaitMs ?? 8000);
  const perCallTimeoutMs = Math.max(
    MIN_GEMINI_DEADLINE_MS,
    Math.min(60_000, options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS)
  );
  const totalBudgetMs = options.totalBudgetMs
    ? Math.max(MIN_GEMINI_DEADLINE_MS, options.totalBudgetMs)
    : undefined;
  const startedAt = Date.now();

  const ai = options.client ?? getGeminiClient();
  const sleep = options.sleepFn ?? defaultSleep;
  const random = options.randomFn ?? Math.random;

  let totalRetries = 0;
  let lastClassified: ClassifiedGeminiErrorInfo | null = null;
  let lastModel = primaryModel;
  const attemptsSummary: GeminiAttemptSummary[] = [];

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    if (totalBudgetMs !== undefined) {
      const remaining = totalBudgetMs - (Date.now() - startedAt);
      if (remaining < MIN_GEMINI_DEADLINE_MS) {
        break;
      }
    }

    const model = modelsToTry[modelIndex];
    const isFallback = modelIndex > 0;
    const maxAttempts = isFallback ? maxFallbackAttempts : maxPrimaryAttempts;
    lastModel = model;

    if (isFallback) {
      console.info(
        '[Gemini]',
        JSON.stringify({
          operation: options.operation,
          fromModel: modelsToTry[modelIndex - 1],
          toModel: model,
          previousStatus: lastClassified?.status ?? null,
          retryCount: totalRetries,
          fallbackOutcome: 'attempting',
        })
      );
    }

    let modelAttempts = 0;
    let modelLastStatus = 500;
    let modelLastApiStatus = 'INTERNAL';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let callTimeoutMs = perCallTimeoutMs;
      if (totalBudgetMs !== undefined) {
        const remaining = totalBudgetMs - (Date.now() - startedAt);
        if (remaining < MIN_GEMINI_DEADLINE_MS) {
          break;
        }
        callTimeoutMs = Math.max(MIN_GEMINI_DEADLINE_MS, Math.min(perCallTimeoutMs, remaining));
      }

      modelAttempts = attempt;
      const attemptConfig: GenerateContentParameters['config'] = {
        ...(options.config || {}),
        abortSignal: options.config?.abortSignal ?? AbortSignal.timeout(callTimeoutMs),
        httpOptions: {
          ...(options.config?.httpOptions || {}),
          timeout: options.config?.httpOptions?.timeout ?? callTimeoutMs,
        },
        ...(options.preferLowThinking &&
        !options.config?.thinkingConfig &&
        isGemini3Or4Model(model)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      };

      try {
        const response = await ai.models.generateContent({
          model,
          contents: options.contents,
          config: attemptConfig,
        });

        attemptsSummary.push({
          model,
          status: 200,
          apiStatus: 'OK',
          attempts: modelAttempts,
        });

        if (isFallback || totalRetries > 0) {
          console.info(
            '[Gemini]',
            JSON.stringify({
              operation: options.operation,
              model,
              httpStatus: 200,
              attempt,
              retryCount: totalRetries,
              fallbackUsed: isFallback,
              fallbackOutcome: isFallback ? 'succeeded' : 'not_needed',
              attemptsSummary,
            })
          );
        }

        return {
          response,
          modelUsed: model,
          retryCount: totalRetries,
          fallbackUsed: isFallback,
        };
      } catch (err) {
        const classified = classifyGeminiError(err);
        lastClassified = classified;
        modelLastStatus = classified.status;
        modelLastApiStatus = classified.apiStatus;

        const retryAfterTooLong =
          classified.retryAfterMs !== undefined && classified.retryAfterMs > maxRetryAfterWaitMs;
        let willRetrySameModel =
          classified.retryable && !retryAfterTooLong && attempt < maxAttempts;

        let nextDelayMs: number | undefined;
        if (willRetrySameModel) {
          const expDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
          const jitter = Math.floor(random() * Math.min(350, Math.round(expDelay * 0.5)));
          nextDelayMs = expDelay + jitter;
          if (classified.retryAfterMs !== undefined && classified.retryAfterMs > nextDelayMs) {
            nextDelayMs = Math.min(maxRetryAfterWaitMs, classified.retryAfterMs);
          }

          if (totalBudgetMs !== undefined) {
            const remainingAfterSleep = totalBudgetMs - (Date.now() - startedAt) - nextDelayMs;
            if (remainingAfterSleep < MIN_GEMINI_DEADLINE_MS) {
              willRetrySameModel = false;
              nextDelayMs = undefined;
            }
          }
        }

        console.warn(
          '[Gemini]',
          JSON.stringify({
            operation: options.operation,
            model,
            httpStatus: classified.status,
            apiStatus: classified.apiStatus,
            attempt,
            maxAttempts,
            retryCount: totalRetries,
            isQuotaExhausted: classified.isQuotaExhausted,
            retryAfterMs: classified.retryAfterMs ?? null,
            willRetrySameModel,
            nextDelayMs: nextDelayMs ?? null,
            fallbackAvailable: modelIndex < modelsToTry.length - 1 && classified.canFallback,
          })
        );

        if (willRetrySameModel && nextDelayMs !== undefined) {
          totalRetries++;
          await sleep(nextDelayMs);
          continue;
        }

        // Stop retrying this model; break out to try fallback if eligible.
        break;
      }
    }

    if (modelAttempts > 0) {
      attemptsSummary.push({
        model,
        status: modelLastStatus,
        apiStatus: modelLastApiStatus,
        attempts: modelAttempts,
      });
    }

    const hasNextModel = modelIndex < modelsToTry.length - 1;
    if (!hasNextModel || !lastClassified?.canFallback) {
      break;
    }
  }

  const baseInfo = lastClassified || {
    status: 500,
    apiStatus: 'INTERNAL',
    message: 'Unexpected backend error while communicating with Gemini AI.',
    retryable: false,
    canFallback: false,
    isQuotaExhausted: false,
  };
  const attemptDetail =
    attemptsSummary.length > 0
      ? ` Attempted: ${attemptsSummary.map((a) => `${a.model} (${a.status} x${a.attempts})`).join(', ')}.`
      : '';

  const finalError = new GeminiClassifiedError({
    ...baseInfo,
    message: `${baseInfo.message}${attemptDetail}`,
    model: lastModel,
    retryCount: totalRetries,
    fallbackUsed: modelsToTry.length > 1 && lastModel !== primaryModel,
    attemptsSummary,
  });

  console.error(
    '[Gemini]',
    JSON.stringify({
      operation: options.operation,
      model: finalError.model,
      httpStatus: finalError.status,
      apiStatus: finalError.apiStatus,
      retryCount: finalError.retryCount,
      fallbackUsed: finalError.fallbackUsed,
      fallbackOutcome: finalError.fallbackUsed ? 'failed' : 'not_attempted',
      attemptsSummary: finalError.attemptsSummary,
    })
  );

  throw finalError;
}
