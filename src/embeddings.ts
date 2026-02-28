import { FeatureExtractionPipeline } from '@huggingface/transformers';

// Using dynamic import to avoid TypeScript's union type complexity on `pipeline`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PipelineFn = (...args: any[]) => Promise<FeatureExtractionPipeline>;

let embedder: FeatureExtractionPipeline | null = null;

export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    process.stderr.write('[mtmem] Loading embedding model (first run may take a moment)...\n');
    const { pipeline } = await import('@huggingface/transformers');
    embedder = await (pipeline as unknown as PipelineFn)('feature-extraction', 'nomic-ai/nomic-embed-text-v1');
    process.stderr.write('[mtmem] Embedding model ready.\n');
  }
  return embedder;
}

export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}
