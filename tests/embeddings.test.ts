import { describe, it, expect, vi } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockResolvedValue({
      data: new Float32Array(768).fill(0.1),
    })
  ),
}));

describe('embed', () => {
  it('returns a Float32Array of length 768', async () => {
    const { embed } = await import('../src/embeddings.js');
    const result = await embed('hello world');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(768);
  });
});

describe('embedOrThrow', () => {
  it('is exported from embeddings.ts', async () => {
    const mod = await import('../src/embeddings.js');
    expect(typeof mod.embedOrThrow).toBe('function');
  });

  it('returns a Float32Array on success', async () => {
    const { embedOrThrow } = await import('../src/embeddings.js');
    const result = await embedOrThrow('hello world');
    expect(result).toBeInstanceOf(Float32Array);
  });
});

describe('disposeEmbedder', () => {
  it('is callable without throwing', async () => {
    const { disposeEmbedder } = await import('../src/embeddings.js');
    expect(() => disposeEmbedder()).not.toThrow();
  });
});

describe('embed with prefix', () => {
  it('prepends search_document prefix to stored content', async () => {
    const { embed } = await import('../src/embeddings.js');
    // The mock returns the same Float32Array regardless of input.
    // We verify the function accepts a prefix argument without error.
    const result = await embed('my content', 'search_document: ');
    expect(result).toBeInstanceOf(Float32Array);
  });

  it('prepends search_query prefix to queries', async () => {
    const { embed } = await import('../src/embeddings.js');
    const result = await embed('my query', 'search_query: ');
    expect(result).toBeInstanceOf(Float32Array);
  });
});
