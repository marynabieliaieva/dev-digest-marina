import { describe, it, expect, vi } from 'vitest';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

const repo = { owner: 'o', name: 'r' };

function clientWith(data: unknown) {
  const getContent = vi.fn().mockResolvedValue({ data });
  const client = new OctokitGitHubClient('test-token');
  (client as unknown as { octokit: unknown }).octokit = { rest: { repos: { getContent } } };
  return { client, getContent };
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

describe('OctokitGitHubClient.getFileContent', () => {
  it('decodes a base64 file to UTF-8', async () => {
    const text = '# Plan\nПривіт';
    const { client, getContent } = clientWith({
      type: 'file',
      size: Buffer.byteLength(text),
      encoding: 'base64',
      content: b64(text),
    });
    const res = await client.getFileContent(repo, 'docs/plans/x.md', 'abc123');
    expect(res).toEqual({ path: 'docs/plans/x.md', ref: 'abc123', text, size: Buffer.byteLength(text) });
    expect(getContent).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      path: 'docs/plans/x.md',
      ref: 'abc123',
    });
  });

  it('rejects path traversal and absolute paths without calling GitHub', async () => {
    const { client, getContent } = clientWith({});
    await expect(client.getFileContent(repo, '../secret', 'main')).rejects.toThrow();
    await expect(client.getFileContent(repo, 'docs/../../x', 'main')).rejects.toThrow();
    await expect(client.getFileContent(repo, '/etc/passwd', 'main')).rejects.toThrow();
    expect(getContent).not.toHaveBeenCalled();
  });

  it('rejects a directory listing', async () => {
    const { client } = clientWith([{ type: 'file', name: 'a' }]);
    await expect(client.getFileContent(repo, 'docs', 'main')).rejects.toThrow(/not a file/i);
  });

  it('rejects non-file types (symlink/submodule)', async () => {
    const { client } = clientWith({ type: 'symlink', size: 3 });
    await expect(client.getFileContent(repo, 'a', 'main')).rejects.toThrow(/not a file/i);
  });

  it('rejects oversize files', async () => {
    const { client } = clientWith({
      type: 'file',
      size: 256 * 1024 + 1,
      encoding: 'base64',
      content: b64('x'),
    });
    await expect(client.getFileContent(repo, 'big.md', 'main')).rejects.toThrow(/too large/i);
  });

  it('rejects binary content (NUL byte)', async () => {
    const { client } = clientWith({
      type: 'file',
      size: 4,
      encoding: 'base64',
      content: b64(Buffer.from([0x89, 0x50, 0x00, 0x47])),
    });
    await expect(client.getFileContent(repo, 'img.png', 'main')).rejects.toThrow(/binary/i);
  });
});
