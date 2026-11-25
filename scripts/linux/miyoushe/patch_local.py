# -*- coding: utf-8 -*-
"""对上游推送做三处本地改造(本套件只开游戏社区签到):

1. 账号摘要只输出本次真跑过的段 —— 上游固定印三段,没跑也印「本次未执行…」。
2. 米游币段的「跑过没有」判定改严 —— 上游用 "社区签到" 子串匹配,「游戏社区签到汇总」也会命中,
   于是没跑米游币也印出一段全 0 的空摘要(光删段落堵不住,必须同时改判定)。
3. 推送里不再带「详细日志」整段 —— 那只是签到过程的逐行复述(2026-11-25 用户要求去掉)。

第 1、2 条改 Python 函数体:三段摘要先由 Python 拼好再交给模板,改模板治不了。
第 3 条改模板文件。两种改法都先断言锚点存在 —— 上游一改结构就让构建失败,
不允许"补丁静默失效、镜像照常起"。

构建期执行:Dockerfile 里 `RUN python /tmp/patch_local.py`。
"""

from __future__ import annotations

import pathlib
import re
import sys

NOTIFIER = pathlib.Path("/app/miyouqian/service/notifier.py")
TEMPLATES = pathlib.Path("/app/miyouqian/templates/push")

TEXT_FN = '''def build_account_sections_text(summary: dict[str, Any], markdown: bool = False) -> str:
    """账号摘要(文本)。只输出本次真跑过的段(local patch)。"""
    sections = summary["sections"]
    if not sections:
        return "- 无账号信息"
    blocks: list[str] = []
    for section in sections:
        if not (
            section["game"]["present"]
            or section["cloud_game"]["present"]
            or section["bbs"]["present"]
        ):
            continue
        heading = f"#### {section['label']}" if markdown else f"[{section['label']}]"
        lines = [heading, "游戏社区签到：", build_game_section_text(section, markdown=markdown)]
        if section["cloud_game"]["present"]:
            lines += ["云游戏签到：", build_cloud_game_section_text(section, markdown=markdown)]
        if section["bbs"]["present"]:
            lines += ["米游币获取：", build_bbs_section_text(section, markdown=markdown)]
        blocks.append("\\n".join(lines))
    return "\\n\\n".join(blocks) or "- 无账号信息"


'''

HTML_FN = '''def build_account_sections_html(summary: dict[str, Any]) -> str:
    """账号摘要(HTML)。只输出本次真跑过的段(local patch)。"""
    sections = summary["sections"]
    if not sections:
        return section_empty_html("账号摘要", "无账号信息")
    parts: list[str] = []
    for index, section in enumerate(sections):
        if not (
            section["game"]["present"]
            or section["cloud_game"]["present"]
            or section["bbs"]["present"]
        ):
            continue
        open_attr = " open" if index == 0 else ""
        extra = ""
        if section["cloud_game"]["present"]:
            extra += f'<div style="margin-bottom:8px;">{build_cloud_game_section_html(section)}</div>'
        if section["bbs"]["present"]:
            extra += build_bbs_section_html(section)
        parts.append(
            f"""
            <details{open_attr} style="border:1px solid #d8e4ef;border-radius:8px;background:#fff;margin-bottom:10px;overflow:hidden;">
              <summary style="cursor:pointer;list-style:none;padding:12px 14px;background:#f1f7fc;color:#102033;font-size:15px;font-weight:800;">{html.escape(section["label"])}</summary>
              <div style="padding:10px;">
                <div style="margin-bottom:8px;">{build_game_section_html(section)}</div>
                {extra}
              </div>
            </details>
            """.strip()
        )
    return "\\n".join(parts) or section_empty_html("账号摘要", "无账号信息")


'''

BBS_PRESENT_OLD = (
    '    bbs_present = bool(bbs_summary or bbs_progress or '
    'any("米游币" in line or "社区签到" in line for line in lines))'
)

BBS_PRESENT_NEW = (
    '    # local patch:上游拿 "社区签到" 做子串匹配,「游戏社区签到汇总」也会命中,\n'
    '    # 于是没跑米游币任务也印出一段全 0 的空摘要。改为只认真正跑过的痕迹。\n'
    '    bbs_present = bool(bbs_summary or bbs_progress or bbs_end or bbs_completed or\n'
    '                      any(task["done"] or task["failed"] for task in bbs_tasks))'
)

# 每个模板:删掉「详细日志」整段的模式(正则,count=1,DOTALL)
TEMPLATE_PATTERNS: dict[str, str] = {
    "markdown.md": r"\n### 详细日志\n.*\Z",
    "text.txt": r"\n详细日志：\n.*\Z",
    "telegram.html": r"\n<b>详细日志</b>\n<pre>\{\{detail_html\}\}</pre>\n?",
    "html.html": (
        r'\n  <div style="padding:16px[^"]*">\n'
        r"    <div[^>]*>详细日志</div>\n"
        r"    <pre[^>]*>\{\{detail_html\}\}</pre>\n"
        r"  </div>"
    ),
}


def replace_function(source: str, name: str, new_code: str) -> str:
    """把 `def name(` 到下一个顶层 `def ` 之间的整段换成 new_code。"""
    start = re.search(rf"^def {name}\(", source, flags=re.M)
    if not start:
        raise SystemExit(f"锚点消失:找不到 def {name}( —— 上游可能改了结构,补丁需要重写")
    rest = source[start.end():]
    nxt = re.search(r"^def ", rest, flags=re.M)
    end = start.end() + (nxt.start() if nxt else len(rest))
    return source[: start.start()] + new_code + source[end:]


def patch_notifier() -> None:
    source = NOTIFIER.read_text(encoding="utf-8")
    if BBS_PRESENT_OLD not in source:
        raise SystemExit("锚点消失:找不到 bbs_present 那行 —— 上游可能改了判定,补丁需要重写")
    source = source.replace(BBS_PRESENT_OLD, BBS_PRESENT_NEW, 1)
    source = replace_function(source, "build_account_sections_text", TEXT_FN)
    source = replace_function(source, "build_account_sections_html", HTML_FN)
    NOTIFIER.write_text(source, encoding="utf-8")


def patch_templates() -> list[str]:
    changed: list[str] = []
    for name, pattern in TEMPLATE_PATTERNS.items():
        path = TEMPLATES / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if "详细日志" not in text:
            continue
        new = re.sub(pattern, "", text, count=1, flags=re.S)
        if "详细日志" in new:
            raise SystemExit(f"锚点消失:{name} 里还留着「详细日志」,模板结构可能改了,补丁需要重写")
        path.write_text(new, encoding="utf-8")
        changed.append(name)
    if not changed:
        raise SystemExit("锚点消失:没有改到任何推送模板,上游可能换了模板路径")
    return changed


def main() -> int:
    if "local patch" in NOTIFIER.read_text(encoding="utf-8"):
        print("已经打过补丁,跳过")
        return 0
    patch_notifier()
    changed = patch_templates()
    print("补丁完成:账号摘要只输出跑过的段;米游币判定已收紧;详细日志已从模板去掉"
          f"({', '.join(changed)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
