import type { DownloadPort, ExportFile } from '@studio/plugin-sdk';

export class DesktopDownloadService implements DownloadPort {
  async save({ blob, filename }: ExportFile): Promise<void> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const extension = filename.split('.').pop();
    const path = await save({
      title: '导出作品',
      defaultPath: filename.replace(/[\\/]/g, '_'),
      filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : [],
    });
    if (path === null) return;
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  }
}
