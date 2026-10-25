// 服务器存储的 HTTP 客户端与纯函数(与 UI 分开,便于单独看逻辑、也守住单文件行数)。
import { serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
export type Tree = {
  folders: { path: string }[];
  files: { path: string; name: string; size: number; version: string; mtime: number }[];
};

export const TOKEN_KEY = "exc-server-token";
export const LAST_KEY = "exc-server-last";
export const SUFFIX = ".excalidraw";

export async function call(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch("/api" + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

export const withSuffix = (name: string) => (name.endsWith(SUFFIX) ? name : name + SUFFIX);

export const parentOf = (folder: string) => folder.split("/").slice(0, -1).join("/");

export const sizeText = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const pad = (n: number) => String(n).padStart(2, "0");

export const whenText = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 记住"最后打开/保存的位置",用于保存时带 baseVersion 做冲突检测。 */
export function readLast(): { path: string; version: string } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as { path: string; version: string }) : null;
  } catch {
    return null;
  }
}

export const writeLast = (path: string, version: string) =>
  localStorage.setItem(LAST_KEY, JSON.stringify({ path, version }));

/** 把当前编辑器内容序列化成 .excalidraw 的文本(与官方导出同格式,含图片)。 */
export function serializeScene(api: ExcalidrawImperativeAPI | null): string {
  if (!api) return "";
  return serializeAsJSON(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles(), "local");
}
