/**
 * Next.js instrumentation 埋点入口（骨架参考）
 *
 * 位置：项目根目录的 instrumentation.ts（不是 lib/）
 *
 * Next.js 启动时会自动加载此文件。
 *
 * 功能：
 * 1. 初始化 Sentry 错误监控
 * 2. 初始化 OpenTelemetry 基础 tracing
 *
 * 参考：
 * - https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * - https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

export async function register() {
  // 1. Node.js runtime（Server Components / Server Actions / API Routes）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 1.1 Sentry 错误监控
    await import('./sentry.server.config');

    // 1.2 OpenTelemetry 基础追踪
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { Resource } = await import('@opentelemetry/resources');
    const { SemanticResourceAttributes } = await import('@opentelemetry/semantic-conventions');

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'print-shop-erp',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION ?? 'dev',
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Next.js 本身已经有一些埋点，避免重复
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    sdk.start();
  }

  // 2. Edge runtime（Middleware）
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * 可选：onRequestError hook（Next.js 15+ 支持）
 * 在 Server Component 和 Server Action 错误时调用
 */
export async function onRequestError(err: unknown, request: Request) {
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureException(err, {
    extra: {
      url: request.url,
      method: request.method,
    },
  });
}
