import { describe, it, expect, vi, beforeAll } from 'vitest';

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
