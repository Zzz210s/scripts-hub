// 面板样式与列表:与逻辑分开,既让 ServerStorage.tsx 守住行数,也便于单独调外观。
import { parentOf, sizeText, whenText, type Tree } from "./api";

export const box: React.CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 64,
  zIndex: 6,
  background: "var(--island-bg-color, #fff)",
  color: "var(--text-primary-color, #1b1b1f)",
  border: "1px solid var(--dialog-border-color, #d4d4d8)",
  borderRadius: 10,
  padding: 12,
  fontSize: 13,
  boxShadow: "0 8px 24px rgba(0,0,0,.18)",
};

export const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 };
export const item: React.CSSProperties = { padding: "6px 8px", cursor: "pointer", borderBottom: "1px solid #f1f1f4" };

/** 当前目录下的直接子目录与文件。 */
export function childrenOf(tree: Tree, folder: string) {
  return {
    folders: tree.folders.filter((f) => parentOf(f.path) === folder),
    files: tree.files.filter((f) => parentOf(f.path) === folder),
  };
}

export const StorageList = ({
  tree,
  folder,
  onEnterFolder,
  onPickFile,
}: {
  tree: Tree;
  folder: string;
  onEnterFolder: (path: string) => void;
  onPickFile: (file: Tree["files"][number]) => void;
}) => {
  const { folders, files } = childrenOf(tree, folder);
  return (
    <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid #eee", borderRadius: 8, marginBottom: 8 }}>
      {folders.length === 0 && files.length === 0 && <div style={{ ...item, color: "#888" }}>这个目录是空的</div>}
      {folders.map((f) => (
        <div key={f.path} style={item} onClick={() => onEnterFolder(f.path)}>
          目录 / {f.path.split("/").pop()}
        </div>
      ))}
      {files.map((f) => (
        <div key={f.path} style={item} title={`${whenText(f.mtime)} · 点一下填名字;打开模式下会直接载入`} onClick={() => onPickFile(f)}>
          {f.name} <span style={{ color: "#888" }}>· {sizeText(f.size)} · {whenText(f.mtime)}</span>
        </div>
      ))}
    </div>
  );
};
