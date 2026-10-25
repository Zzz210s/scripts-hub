import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { openLocalFile, saveLocal } from "./localFile";
import { ServerStorage } from "./storage/panel";
import { serializeScene } from "./storage/api";
import "@excalidraw/excalidraw/index.css";

// 一个很薄的壳:官方组件负责画布,壳负责"存到服务器 / 从服务器打开 / 本地文件 / 本地自动草稿"。
// 不修改上游源码,升级 = 改 package.json 里 @excalidraw/excalidraw 的版本号后重建。
const DRAFT_KEY = "studio-scene";

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [status, setStatus] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自动草稿:只存本地浏览器,防止误刷新丢图;要长期保存请用右侧面板
  const onChange = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!api) return;
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(JSON.parse(serializeScene(api))));
      } catch {
        // 图太大(超过 localStorage 配额)就放弃草稿,不影响主流程
      }
    }, 1200);
  }, [api]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const bar: React.CSSProperties = {
    position: "fixed",
    left: 12,
    bottom: 12,
    zIndex: 6,
    display: "flex",
    gap: 8,
    alignItems: "center",
    background: "var(--island-bg-color, #fff)",
    color: "var(--text-primary-color, #1b1b1f)",
    border: "1px solid var(--dialog-border-color, #d4d4d8)",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 13,
    boxShadow: "0 4px 16px rgba(0,0,0,.12)",
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <Excalidraw
          excalidrawAPI={(instance) => setApi(instance)}
          initialData={loadDraft()}
          onChange={onChange}
          langCode="zh-CN"
        />
        <ServerStorage excalidrawAPI={api} />
        <div style={bar}>
          <button onClick={async () => setStatus(await openLocalFile(api))}>打开本地文件</button>
          <button
            onClick={async () => setStatus(await saveLocal(serializeScene(api), "未命名.excalidraw"))}
            title="支持选文件夹的浏览器会弹出保存对话框,否则下载到下载目录"
          >
            保存到本地
          </button>
          <span style={{ color: "#666" }}>{status}</span>
        </div>
      </div>
    </div>
  );
}
