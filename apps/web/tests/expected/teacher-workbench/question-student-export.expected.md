# Student folder subtree

- complementary "学生图片":
  - button "全选"
  - button "临时保存" [disabled]
  - button "试题图片库"
  - text: 该学生已暂存 0 张
  - button "清空暂存"
  - article:
    - button "第1题.png":
      - img "第1题.png"
    - button "删除"
    - text: 第1题.png
    - checkbox "选择"
    - text: 选择 已保存 0 次 · 最近：暂无
  - article:
    - button "第2题.png":
      - img "第2题.png"
    - button "删除"
    - text: 第2题.png
    - checkbox "选择"
    - text: 选择 已保存 0 次 · 最近：暂无
  - article:
    - button "第3题.png":
      - img "第3题.png"
    - button "删除"
    - text: 第3题.png
    - checkbox "选择"
    - text: 选择 已保存 0 次 · 最近：暂无

# Accumulated across sibling folders

- text: 该学生已暂存 124 张
- button "清空暂存"

# Word save in progress

- dialog "批量生成成功":
  - button "关闭 批量生成成功" [disabled]
  - heading "批量生成成功" [level=3]
  - paragraph: 已生成 1 个文件。点击保存选择目标文件夹。
  - button "保存" [disabled]
  - button "关闭" [disabled]

# Directory selection not completed

- dialog "批量生成成功":
  - button "关闭 批量生成成功"
  - heading "批量生成成功" [level=3]
  - paragraph: 已取消选择保存目录。文件仍可重新保存。
  - button "保存"
  - button "关闭"

# Failed write retained for retry

- dialog "批量生成成功":
  - button "关闭 批量生成成功"
  - heading "批量生成成功" [level=3]
  - paragraph: "已保存 0 个文件，失败 1 个 甲同学.docx: 保存目录不存在，请重新选择"
  - button "保存"
  - button "关闭"

# PowerPoint save in progress

- dialog "批量生成成功":
  - button "关闭 批量生成成功" [disabled]
  - heading "批量生成成功" [level=3]
  - paragraph: 已生成 1 个文件。点击保存选择目标文件夹。
  - button "保存" [disabled]
  - button "关闭" [disabled]

# Saved files

甲同学.docx: existing document preserved

甲同学_1.docx: 124 images

甲同学.pptx: 124 slides

# Cleared selection

- text: 该学生已暂存 0 张
- button "清空暂存"
