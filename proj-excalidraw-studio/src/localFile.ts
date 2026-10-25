// 本地文件:保存时优先让浏览器弹"另存为"对话框(可选文件夹),
// 不支持(非安全上下文,例如 http://IP:端口)就退回普通下载,并明确告诉用户存到哪了。
import { loadFromBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/** 安全上下文才有 showSaveFilePicker;http://IP 下为 false。 */
export const canPickFolder = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

export function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** 保存到本地:能选文件夹就让用户选,不能就下载。返回给界面显示的说明。 */
export async function saveLocal(text: string, fileName: string): Promise<string> {
  if (canPickFolder()) {
    try {
      const handle = await (window as unknown as {
        showSaveFilePicker: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>;
      }).showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: "Excalidraw 场景", accept: { "application/json": [".excalidraw"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return `已保存到所选位置:${fileName}`;
    } catch (error) {
      // 用户取消不算错误
      if (error instanceof Error && error.name === "AbortError") return "已取消保存";
    }
  }
  downloadText(text, fileName);
  return canPickFolder()
    ? "已下载到浏览器下载目录(选位置失败)"
    : "已下载到浏览器下载目录(HTTP 下不能选文件夹,换成 HTTPS 后可选)";
}

/** 从本地选一个 .excalidraw 打开。 */
export async function openLocalFile(api: ExcalidrawImperativeAPI | null): Promise<string> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".excalidraw,application/json";
  const file = await new Promise<File | null>((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
  if (!file) return "已取消";
  try {
    const data = await loadFromBlob(file, null, null);
    const images = Object.values(data.files ?? {});
    if (images.length) api?.addFiles(images);
    api?.updateScene({ elements: data.elements, appState: data.appState });
    return `已打开本地文件:${file.name}`;
  } catch (error) {
    return `本地文件解析失败:${error instanceof Error ? error.message : String(error)}`;
  }
}
