#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把一条投稿 Issue 转成题库里的一道题。

两种用法:
  1. GitHub Actions 里自动跑（读环境变量 ISSUE_BODY / ISSUE_NUMBER）
  2. 本地手动跑:
       ISSUE_BODY="$(gh issue view 12 --json body -q .body)" python scripts/issue_to_questions.py

它会往 data/questions.json 追加一道题，题目 id 用 gh<issue号>，方便追溯来源。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QFILE = os.path.join(ROOT, "data", "questions.json")

# Issue 表单里每个字段的标题，改模板的话这里要一起改
FIELDS = {
    "question": "题干",
    "a": "选项 A",
    "b": "选项 B",
    "c": "选项 C",
    "d": "选项 D",
    "answer": "正确答案",
    "explain": "解析（可选）",
    "category": "分类（可选）",
}


def field(body, label):
    """从 Issue 正文里抠出某个字段的值。表单会渲染成 '### 字段名' 加内容。"""
    pattern = r"###\s*" + re.escape(label) + r"\s*\n+(.*?)(?=\n###\s|\Z)"
    m = re.search(pattern, body, re.S)
    if not m:
        return ""
    value = m.group(1).strip()
    if value in ("_No response_", "无", "None"):
        return ""
    return value


def main():
    body = os.environ.get("ISSUE_BODY", "")
    number = os.environ.get("ISSUE_NUMBER", "0").strip() or "0"

    if not body.strip():
        print("没有拿到 Issue 内容（ISSUE_BODY 是空的），退出。")
        return 1

    values = {key: field(body, label) for key, label in FIELDS.items()}

    question = re.sub(r"\s+", " ", values["question"]).strip()
    options = [re.sub(r"\s+", " ", values[k]).strip() for k in ("a", "b", "c", "d")]
    answer_letter = values["answer"].strip().upper()[:1]

    problems = []
    if not question:
        problems.append("题干是空的")
    if any(not o for o in options):
        problems.append("有选项没填")
    if answer_letter not in "ABCD":
        problems.append("正确答案不是 A/B/C/D")
    if problems:
        print("这道题不完整，跳过：" + "；".join(problems))
        return 1

    record = {
        "id": "gh%s" % number,
        "question": question,
        "options": options,
        "answer": "ABCD".index(answer_letter),
        "explain": re.sub(r"\s+", " ", values["explain"]).strip(),
        "category": values["category"].strip(),
    }

    try:
        with open(QFILE, "r", encoding="utf-8") as f:
            questions = json.load(f)
        if not isinstance(questions, list):
            questions = []
    except (OSError, ValueError):
        questions = []

    # 同一期号重复跑就更新，不重复追加
    for i, q in enumerate(questions):
        if str(q.get("id")) == record["id"]:
            questions[i] = record
            break
    else:
        questions.append(record)

    with open(QFILE, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("已写入第 %d 道：" % len(questions))
    print("  " + record["question"][:60])
    for letter, option in zip("ABCD", record["options"]):
        mark = "  <- 答案" if letter == answer_letter else ""
        print("  %s. %s%s" % (letter, option, mark))
    return 0


if __name__ == "__main__":
    sys.exit(main())
