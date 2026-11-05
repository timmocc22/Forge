import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopDownloadService } from './desktop';

const { save, writeFile } = vi.hoisted(() => ({ save: vi.fn(), writeFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile }));

describe('native export', () => {
  const service = new DesktopDownloadService();
  const file = { filename: '作品.html', blob: new Blob(['<h1>你好</h1>']) };
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it('does not write a file when the user cancels the dialog', async () => {
    save.mockResolvedValue(null);
    await service.save(file);
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('writes the original bytes to the exact path selected by the user', async () => {
    save.mockResolvedValue('/selected/作品.html');
    await service.save(file);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '作品.html' }));
    expect(writeFile).toHaveBeenCalledWith(
      '/selected/作品.html',
      new TextEncoder().encode('<h1>你好</h1>'),
    );
  });
  it('propagates native write failures so the caller can show an error', async () => {
    save.mockResolvedValue('/selected/作品.html');
    writeFile.mockRejectedValue(new Error('Permission denied'));
    await expect(service.save(file)).rejects.toThrow('Permission denied');
  });
});
