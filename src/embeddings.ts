import type { FeatureExtractionPipeline } from '@huggingface/transformers';

type PipelineFn = (task: 'feature-extraction', model: string) => Promise<FeatureExtractionPipeline>;

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;

export function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      process.stderr.write('[mtmem] Loading embedding model (first run may take a moment)...\n');
      const { pipeline } = await import('@huggingface/transformers');
      const e = await (pipeline as unknown as PipelineFn)('feature-extraction', 'nomic-ai/nomic-embed-text-v1');
      process.stderr.write('[mtmem] Embedding model ready.\n');
      return e;
    })();
  }
  return embedderPromise;
}

export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  const data = output.data;
  if (!(data instanceof Float32Array)) {
    throw new Error(`[mtmem] Expected Float32Array from embedder, got ${(data as unknown as { constructor: { name: string } }).constructor.name}`);
  }
  return data;
}

export function disposeEmbedder(): void {
  embedderPromise = null;
}
