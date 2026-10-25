// 面板的两个副作用 hook:快捷键与"首次使用弹一次令牌输入"。
// 单独放这里是为了让 ServerStorage.tsx 保持在单文件行数上限内。
import { useEffect } from "react";

/** Ctrl/Cmd+S:打开保存面板,同时拦掉浏览器自己的"保存网页"。 */
export function useCtrlSOpen(open: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        open();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * 需要令牌时弹一次输入框(拿到 401 时触发)。
 * 只在 active 变 true 的那次触发,避免 prompt 反复弹出。
 */
export function useAutoTokenPrompt(
  active: boolean,
  handlers: { consume: () => void; submit: (token: string) => void; cancel: () => void },
) {
  useEffect(() => {
    if (!active) return;
    handlers.consume();
    const entered = window.prompt("服务器令牌(只存在本浏览器 localStorage)", "");
    if (entered === null) return handlers.cancel();
    handlers.submit(entered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
