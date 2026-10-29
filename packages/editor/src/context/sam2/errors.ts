export function isCancellationError(raw: string): boolean {
  return /cancelled|canceled|abort/i.test(raw);
}
export function mapSegmentationFailure(raw: string): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (raw.includes('safe WASM memory limit')) {
    return {
      code: 'out_of_memory',
      message:
        'Object selection needs more memory than this device can safely use without GPU acceleration. Close other documents or try again on a device with more memory.',
      retryable: false,
    };
  }
  if (raw.startsWith('Worker error:') || /worker.*(failed|undefined)/i.test(raw)) {
    return {
      code: 'worker_crash',
      message: 'The AI worker could not start. Reload the document and try again.',
      retryable: true,
    };
  }
  if (/model.*(exceeds|not downloaded|not installed|missing)/i.test(raw)) {
    return {
      code: 'model_not_installed',
      message:
        'The object-selection model is missing. Install it from Settings, Offline Models, then try again.',
      retryable: true,
    };
  }
  if (raw.includes('timed out') || raw.includes('Inference timed out')) {
    return {
      code: 'inference_timeout',
      message:
        'Object selection took too long to respond. Try again; the next run can reuse the model, or use a smaller image.',
      retryable: true,
    };
  }
  return {
    code: 'unknown',
    message: 'Object selection could not complete. Check the AI model installation and try again.',
    retryable: true,
  };
}

export function mapPromptedRoutingFailure(decision: {
  reason: string;
  rejected: ReadonlyArray<{ code: string; reason: string }>;
}): {
  code: string;
  message: string;
  retryable: boolean;
} {
  const rejection = decision.rejected[0];
  if (rejection?.code === 'exceeds-hard-budget') {
    return {
      code: 'out_of_memory',
      message: rejection.reason,
      retryable: true,
    };
  }
  if (rejection?.code === 'not-installed') {
    return {
      code: 'model_not_installed',
      message: rejection.reason,
      retryable: true,
    };
  }
  if (rejection?.code === 'unsupported-runtime') {
    return {
      code: 'unsupported_runtime',
      message: rejection.reason,
      retryable: false,
    };
  }
  return {
    code: 'provider_unavailable',
    message: rejection?.reason ?? decision.reason,
    retryable: true,
  };
}
