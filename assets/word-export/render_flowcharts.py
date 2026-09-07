#!/usr/bin/env python3
# Gongfang Word export — render tikz flowcharts to PNG.
# For each tikzpicture in the paper (in \input order, shared with merge_paper.py),
# compile with xelatex and crop to the content bounding box via PyMuPDF.
import sys, os, re, subprocess
import fitz  # PyMuPDF

# Directory layout: <project>/转word/工具/render_flowcharts.py -> <project>/转word
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # <project>/转word
ROOT = os.path.dirname(BASE)                                        # <project>
PAPER = os.path.join(ROOT, '论文')
WORK = BASE
IMG_DIR = os.path.join(WORK, '图片')
TMP_DIR = os.path.join(WORK, '渲染')
os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)

# tikz styles shared with 论文.tex
TIKZ_PREAMBLE = r"""
\usepackage{ctex}
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\tikzset{
  box/.style={rectangle, draw, minimum width=3.2cm, minimum height=0.9cm, align=center},
  arrow/.style={thick, -{Stealth}}
}
"""

# article class (bundled in TinyTeX) + no page number; borders cropped by PyMuPDF
ARTICLE_TMPL = r"""\documentclass[border=0pt]{{article}}
\pagestyle{{empty}}
{TIKZ_PREAMBLE}
\begin{{document}}
{CONTENT}
\end{{document}}
"""

def extract_tikz(text):
    """Extract complete tikzpicture blocks (including env options) in document order."""
    blocks = []
    pat = re.compile(r'\\begin\{tikzpicture\}.*?\\end\{tikzpicture\}', re.S)
    for m in pat.finditer(text):
        blocks.append(m.group(0).strip())
    return blocks

def content_bbox(page):
    """Bounding box of all drawn/text content on the page (page coords, y down)."""
    try:
        bboxes = page.get_bboxlog()
        if bboxes and len(bboxes) > 1:  # first entry is the initial empty page box
            import functools, operator
            u = functools.reduce(operator.or_, (fitz.Rect(r) for _, r in bboxes[1:]))
            if u.is_empty:
                return None
            return u
    except Exception:
        pass
    return None

def compile_and_render(content, out_png):
    stem = os.path.splitext(os.path.basename(out_png))[0]
    tex_path = os.path.join(TMP_DIR, stem + '.tex')
    tex = ARTICLE_TMPL.format(TIKZ_PREAMBLE=TIKZ_PREAMBLE, CONTENT=content)
    # Normalize to LF: CRLF makes xelatex fail on Windows ("^^M")
    tex = tex.replace('\r\n', '\n').replace('\r', '\n')
    with open(tex_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(tex)
    for _ in range(1):
        r = subprocess.run(
            ['xelatex', '-interaction=nonstopmode', '-halt-on-error',
             '-output-directory', TMP_DIR, tex_path],
            capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode != 0:
            break
    pdf_path = os.path.join(TMP_DIR, stem + '.pdf')
    if r.returncode != 0 or not os.path.exists(pdf_path):
        tail = (r.stdout or '')[-1500:]
        print(f'[failed] {stem}\n{tail}')
        return False
    doc = fitz.open(pdf_path)
    page = doc[0]
    bb = content_bbox(page)
    clip = bb
    if clip is not None:
        margin = 10  # pt margin so text isn't clipped
        clip = fitz.Rect(max(0, bb.x0 - margin), max(0, bb.y0 - margin),
                         min(page.rect.width, bb.x1 + margin),
                         min(page.rect.height, bb.y1 + margin))
    pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), alpha=False, clip=clip)
    pix.save(out_png)
    doc.close()
    print(f'[done] {os.path.basename(out_png)}  {pix.width}x{pix.height}')
    return True

def find_tex_in_input_order():
    """Return all tex files in \\input order (recursive) from 论文.tex — the same document order
    merge_paper.py uses, so flowchart numbering (流程图N.png) stays consistent. System-level:
    any chapter naming / file distribution is handled."""
    main = os.path.join(PAPER, '论文.tex')
    if not os.path.exists(main):
        return []
    files = []
    def walk(path, stack=()):
        if path in stack or not os.path.exists(path):
            return
        stack = stack + (path,)
        try:
            with open(path, encoding='utf-8') as f:
                txt = f.read()
        except Exception:
            return
        files.append(path)
        for mm in re.finditer(r'\\input\{([^}]+)\}', txt):
            sub = mm.group(1)
            if not sub.endswith('.tex'):
                sub += '.tex'
            walk(os.path.join(PAPER, sub), stack)
    walk(main)
    return files

def main():
    ok = 0
    seq = 0  # global flowchart number, must match merge_paper.py's clean_flowcharts
    tex_files = find_tex_in_input_order()
    if not tex_files:
        print('[skipped] 论文.tex not found')
        return
    for tex_file in tex_files:
        try:
            with open(tex_file, encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue
        blocks = extract_tikz(text)
        for content in blocks:
            seq += 1
            out_png = os.path.join(IMG_DIR, f'流程图{seq}.png')
            if compile_and_render(content, out_png):
                ok += 1
    print(f'rendered {ok} flowcharts')

if __name__ == '__main__':
    main()
