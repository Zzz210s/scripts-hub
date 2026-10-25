import { useCallback, useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import { call, downloadText, parentOf, readLast, TOKEN_KEY, type Tree, withSuffix, writeLast } from "./serverStorageApi";
import { box, childrenOf, row, StorageList } from "./storageList";

// 服务器存储面板:存到自建服务的目录树 / 从目录树打开 / 下载到本地。
// 由 scripts-hub/proj-excalidraw-web 注入上游 excalidraw-app(见 patch.mjs);锚点消失时补丁会直接失败。

export const ServerStorage = ({ excalidrawAPI }: { excalidrawAPI: ExcalidrawImperativeAPI | null }) => {
  const [mode, setMode] = useState<null | "open" | "save">(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [tree, setTree] = useState<Tree>({ folders: [], files: [] });
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const loadTree = useCallback(
    async (nextToken = token) => {
      setBusy(true);
      const { status: code, body } = await call("/tree", nextToken);
      setBusy(false);
      if (code === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        return setStatus("令牌不对:点「令牌」重新填写");
      }
      if (code !== 200) return setStatus(`读取目录失败(${code})`);
      setTree(body as Tree);
      setStatus("");
    },
    [token],
  );

  // Ctrl/Cmd+S 开保存面板(同时拦掉浏览器自己"保存网页")
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        setMode("save");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (mode) void loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const askToken = () => {
    const entered = window.prompt("服务器令牌(只存在本浏览器)", token);
    if (entered === null) return;
    localStorage.setItem(TOKEN_KEY, entered);
    setToken(entered);
    void loadTree(entered);
  };

  const sceneText = () =>
    excalidrawAPI
      ? serializeAsJSON(
          excalidrawAPI.getSceneElementsIncludingDeleted(),
          excalidrawAPI.getAppState(),
          excalidrawAPI.getFiles(),
          "local",
        )
      : "";

  const doSave = async (overwrite = false) => {
    if (!name.trim()) return setStatus("先填文件名");
    const fileName = withSuffix(name.trim());
    if (fileName !== name) setName(fileName);
    const path = folder ? `${folder}/${fileName}` : fileName;
    const last = readLast();
    const baseVersion = !overwrite && last?.path === path ? last.version : undefined;
    setBusy(true);
    const { status: code, body } = await call(`/scene?path=${encodeURIComponent(path)}`, token, {
      method: "PUT",
      body: JSON.stringify({ scene: JSON.parse(sceneText()), baseVersion }),
    });
    setBusy(false);
    if (code === 409) {
      setConflict(path);
      return setStatus("服务器上的文件已被更新(可能另一处刚存过):覆盖还是另存?");
    }
    if (code !== 200) return setStatus(`保存失败(${code})${body.error ? `:${body.error}` : ""}`);
    writeLast(path, body.version);
    setConflict(null);
    setStatus(`已保存到服务器:${path}`);
    void loadTree();
  };

  const doOpen = async (raw: string) => {
    const target = withSuffix(raw);
    setBusy(true);
    const { status: code, body } = await call(`/scene?path=${encodeURIComponent(target)}`, token);
    setBusy(false);
    if (code !== 200) return setStatus(`打开失败(${code})${body.error ? `:${body.error}` : ""}`);
    try {
      const blob = new Blob([JSON.stringify(body.scene)], { type: "application/json" });
      const data = await loadFromBlob(blob, null, null);
      // updateScene 不接受 files:图片要先通过 addFiles 注册,再更新场景(顺序反了图片会缺)
      const images = Object.values(data.files ?? {});
      if (images.length) excalidrawAPI?.addFiles(images);
      excalidrawAPI?.updateScene({ elements: data.elements, appState: data.appState });
      writeLast(target, body.version);
      setFolder(parentOf(target));
      setName(target.split("/").pop() ?? "");
      setMode(null);
      setStatus(`已打开:${target}`);
    } catch (error) {
      setStatus(`文件解析失败:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const doNewFolder = async () => {
    const input = window.prompt("新文件夹名(可带 / 建子目录)", "");
    if (!input) return;
    const path = folder ? `${folder}/${input}` : input;
    const { status: code } = await call("/folder", token, { method: "POST", body: JSON.stringify({ path }) });
    if (code !== 200) return setStatus(`建文件夹失败(${code})`);
    setFolder(path);
    void loadTree();
  };

  if (!mode) {
    return (
      <button style={{ ...box, cursor: "pointer" }} onClick={() => setMode("save")} title="保存到服务器 / 打开服务器文件(Ctrl+S)">服务器存储</button>
    );
  }

  return (
    <div style={{ ...box, width: 460, maxHeight: "70vh", overflow: "auto" }}>
      <div style={row}>
        <strong>{mode === "save" ? "保存到服务器" : "从服务器打开"}</strong>
        <span style={{ flex: 1 }} />
        <button onClick={() => setMode(mode === "save" ? "open" : "save")}>{mode === "save" ? "改为打开" : "改为保存"}</button>
        <button onClick={() => setMode(null)}>关闭</button>
      </div>

      <div style={row}>
        <span>位置:</span>
        <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>scenes/{folder || "根目录"}</code>
        <button disabled={!folder} onClick={() => setFolder(parentOf(folder))}>上一级</button>
        <button onClick={doNewFolder}>新建文件夹</button>
        <button onClick={askToken}>令牌</button>
      </div>

      <StorageList
        tree={tree}
        folder={folder}
        onEnterFolder={setFolder}
        onPickFile={(file) => {
          setName(file.name);
          if (mode === "open") void doOpen(file.path);
        }}
      />

      <div style={row}>
        <input
          style={{ flex: 1, padding: 6 }}
          placeholder="文件名,例如 架构图"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void (mode === "save" ? doSave() : doOpen(name));
          }}
        />
        {mode === "save" ? (
          <button disabled={busy} onClick={() => void doSave()}>保存</button>
        ) : (
          <button disabled={busy || !name.trim()} onClick={() => void doOpen(name)}>打开</button>
        )}
        <button onClick={() => { downloadText(sceneText(), withSuffix(name.trim() || "未命名")); setStatus("已下载到本地"); }}>
          下载到本地
        </button>
      </div>

      {conflict && (
        <div style={{ ...row, color: "#b42318" }}>
          <span>已被别人更新过。</span>
          <button onClick={() => void doSave(true)}>覆盖</button>
          <button
            onClick={() => {
              setConflict(null);
              setName(`副本-${withSuffix(name.trim())}`);
              setStatus("换了名字,再点保存就是另存");
            }}
          >另存</button>
        </div>
      )}

      {status && <div style={{ color: /失败|不对|已被|解析/.test(status) ? "#b42318" : "#067647" }}>{status}</div>}
      {busy && <div style={{ color: "#666" }}>处理中…</div>}
    </div>
  );
};

