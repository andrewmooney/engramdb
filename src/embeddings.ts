import type { FeatureExtractionPipeline } from '@huggingface/transformers';

type PipelineFn = (task: 'feature-extraction', model: string) => Promise<FeatureExtractionPipeline>;

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;

export function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      process.stderr.write('[engramdb] Loading embedding model (first run may take a moment)...\n');
      const { pipeline } = await import('@huggingface/transformers');
      const e = await (pipeline as unknown as PipelineFn)('feature-extraction', 'nomic-ai/nomic-embed-text-v1');
      process.stderr.write('[engramdb] Embedding model ready.\n');
      return e;
    })();
  }
  return embedderPromise;
}

export async function embed(text: string, prefix = ''): Promise<Float32Array> {
  const pipe = await getEmbedder();
  const output = await pipe(prefix + text, { pooling: 'mean', normalize: true });
  const data = output.data;
  if (!(data instanceof Float32Array)) {
    throw new Error(`[engramdb] Expected Float32Array from embedder, got ${(data as unknown as { constructor: { name: string } }).constructor.name}`);
  }
  return data;
}

/** Embeds text and wraps any error with an [engramdb] prefix. Use instead of embed().catch(...) inline. */
export async function embedOrThrow(text: string, prefix = ''): Promise<Float32Array> {
  return embed(text, prefix).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[engramdb] Embedding failed: ${msg}`);
  });
}

export function disposeEmbedder(): void {
  if (embedderPromise) {
    // Attempt to dispose ONNX session if the pipeline exposes it
    embedderPromise.then((pipe) => {
      if (typeof (pipe as unknown as { dispose?: () => void }).dispose === 'function') {
        (pipe as unknown as { dispose: () => void }).dispose();
      }
    }).catch(() => { /* ignore dispose errors */ });
  }
  embedderPromise = null;
}
