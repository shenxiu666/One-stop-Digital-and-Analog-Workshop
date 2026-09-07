#!/usr/bin/env python3
# Gongfang Word export — merge LaTeX chapters into one flat .tex for pandoc.
# Pipeline: merge chapters (this script) -> pandoc + layout.lua -> postprocess.py
import sys, os, re, json

# Directory layout: <project>/转word/工具/merge_paper.py -> <project>/转word
WORK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # <project>/转word
ROOT = os.path.dirname(WORK)                                        # <project>

def find_paper_dir():
    # Compatible with two layouts: task-synced (论文/论文.tex) and write-panel-created (论文.tex at project root)
    for cand in (os.path.join(ROOT, '论文'), ROOT):
        if os.path.exists(os.path.join(cand, '论文.tex')):
            return cand
    return os.path.join(ROOT, '论文')
PAPER = find_paper_dir()

IMG_DIR = '图片'   # relative to 转word

# Markers consumed by layout.lua (page breaks / title styling / explicit TOC)
PAGE_BREAK_MARK = 'GONGFANG_PAGEBREAK'
TITLE_MARK = 'GONGFANG_TITLE'
TOC_MARK = 'GONGFANG_TOC'

# ============ 1) Read main file, extract title ============
main_tex = open(os.path.join(PAPER, '论文.tex'), encoding='utf-8').read()
m = re.search(r'\\centering\s*\\zihao\{3\}\s*\\bfseries\s*(.*?)\\par', main_tex, re.S)
title = m.group(1).strip() if m else ''

# ============ 2) Chapter order = actual \input order from 论文.tex (system-level, no hardcoded names) ============
inputs = re.findall(r'\\input\{([^}]+)\}', main_tex)
top_files = []
seen = set()
for inp in inputs:
    if not inp.endswith('.tex'):
        inp += '.tex'
    if inp not in seen:
        seen.add(inp)
        top_files.append(inp)

# Fallback: no \input at all (single-file inline paper) -> use document body as the only chapter
if not top_files:
    body = re.search(r'\\begin\{document\}(.*?)\\end\{document\}', main_tex, re.S)
    if body and body.group(1).strip():
        inline_path = os.path.join(WORK, '_body.tex')
        with open(inline_path, 'w', encoding='utf-8') as f:
            f.write(body.group(1))
        top_files = [inline_path]

def resolve(path, _stack=()):
    """Recursively expand \\input, return full text in document order. Missing files warn + skip, never abort."""
    full = path if os.path.isabs(path) else os.path.join(PAPER, path)
    if full in _stack:
        return ''
    if not os.path.exists(full):
        print(f'WARN: missing chapter {full}, skipped')
        return ''
    with open(full, encoding='utf-8') as f:
        txt = f.read()
    def repl(mm):
        sub = mm.group(1)
        if not sub.endswith('.tex'):
            sub += '.tex'
        return resolve(sub, _stack + (full,))
    return re.sub(r'\\input\{([^}]+)\}', repl, txt)

chapters = [resolve(p) for p in top_files]

# Expand 论文.tex body in document order, KEEPING inter-chapter content
# (\\newpage, pagestyle, etc.) so page breaks and spacing survive.
def expand_body(text):
    def repl(mm):
        sub = mm.group(1)
        if not sub.endswith('.tex'):
            sub += '.tex'
        return resolve(sub)
    return re.sub(r'\\input\{([^}]+)\}', repl, text)

_body_m = re.search(r'\\begin\{document\}(.*?)\\end\{document\}', main_tex, re.S)
doc = expand_body(_body_m.group(1)) if _body_m else ''
if not doc.strip():
    doc = '\n\n'.join(chapters)

# ============ 3) Count figure/table/equation numbers; build label -> (kind, number) map ============
label_map = {}
counters = {'figure': 0, 'table': 0, 'equation': 0}
scan_pat = re.compile(
    r'\\begin\{(figure|table|longtable)\}|'
    r'\\begin\{(equation|align|gather|multline)(\*)?\}|'
    r'\\label\{([^}]+)\}')
for mm in scan_pat.finditer(doc):
    if mm.group(1):
        counters[{'longtable': 'table'}.get(mm.group(1), mm.group(1))] += 1
    elif mm.group(2):
        counters['equation'] += 1
    elif mm.group(4):
        lab = mm.group(4)
        if lab.startswith('fig:'):
            label_map[lab] = ('图', counters['figure'])
        elif lab.startswith('tab:'):
            label_map[lab] = ('表', counters['table'])
        elif lab.startswith('eq:'):
            label_map[lab] = ('式', counters['equation'])
print(f'figures {counters["figure"]}, tables {counters["table"]}, equations {counters["equation"]}')
print(f'cross-ref labels {len(label_map)}')

# ============ 3.5) References: number \bibitem, convert \cite -> [n] ============
# Strip % comments before counting, so \bibitem{..} mentioned in template comments
# doesn't shift the numbering (comments would otherwise add fake keys).
doc_nc = re.sub(r'(?<!\\)%.*', '', doc)
bib_keys = re.findall(r'\\bibitem\{([^}]+)\}', doc_nc)
bib_num = {k: i + 1 for i, k in enumerate(bib_keys)}
print(f'references {len(bib_keys)}')

def cite_repl(mm):
    keys = [k.strip() for k in mm.group(1).split(',')]
    nums = [str(bib_num[k]) for k in keys if k in bib_num]
    return '[' + ','.join(nums) + ']' if nums else mm.group(0)

# ============ 4) Per-file replacements -> clean fragment ============
flowchart_seq = [0]  # Nth tikzpicture in document order (shared with render_flowcharts.py)

def clean_flowcharts(text):
    """Replace tikzpicture with includegraphics 流程图N.png (global order shared with the render script)."""
    def repl(mm):
        n = flowchart_seq[0] + 1
        flowchart_seq[0] = n
        png = os.path.join(WORK, IMG_DIR, f'流程图{n}.png').replace('\\', '/')
        return '\\includegraphics[width=0.82\\textwidth]{%s}' % png
    return re.sub(r'\\begin\{tikzpicture\}.*?\\end\{tikzpicture\}', repl, text, flags=re.S)

BALANCED_BRACE = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'

def clean_colspec(spec):
    """Clean table column spec: drop >{...}/<{...}/\arraybackslash, map X/L/R/C to l."""
    inner = spec[1:-1] if spec.startswith('{') else spec
    inner = re.sub(r'>\{[^{}]*\}', '', inner)
    inner = re.sub(r'<\{[^{}]*\}', '', inner)
    inner = inner.replace('\\arraybackslash', '')
    inner = re.sub(r'[XCRL]', 'l', inner)
    return inner

fig_no = [0]
tab_no = [0]
table_ratios = []  # column width ratios per table (document order)

def col_ratios(spec):
    """Extract per-column width ratios from p{X\textwidth}; otherwise equal split."""
    ws = re.findall(r'p\{([0-9.]+)', spec)
    if ws:
        return [float(w) for w in ws]
    cleaned = re.sub(r'>\{[^{}]*\}', '', spec).replace('\\arraybackslash', '')
    letters = re.findall(r'[lcrXLR]', cleaned)
    return [1.0] * len(letters) if letters else []

def number_captions(text):
    """Prefix figure/table \\caption with '图 N' / '表 N' (order matches \\begin{figure}/longtable)."""
    out = []
    i = 0
    cur = None
    pat = re.compile(r'\\(begin|end)\{(figure|longtable|table|tabularx|tabular)\}|\\caption\b')
    for m in pat.finditer(text):
        out.append(text[i:m.start()])
        if m.group(1) == 'begin':
            env = m.group(2)
            if env == 'figure':
                fig_no[0] += 1
                cur = 'fig'
            elif env in ('longtable', 'table'):
                tab_no[0] += 1
                cur = 'tab'
            out.append(m.group(0))
        elif m.group(1) == 'end':
            if m.group(2) in ('figure', 'longtable', 'table'):
                cur = None
            out.append(m.group(0))
        else:  # \caption{...}
            if cur:
                o = text.find('{', m.end())
                depth = 0
                k = o
                while k < len(text):
                    if text[k] == '{':
                        depth += 1
                    elif text[k] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    k += 1
                content = text[o + 1:k]
                prefix = ('图 %d ' % fig_no[0]) if cur == 'fig' else ('表 %d ' % tab_no[0])
                out.append('\\caption{' + prefix + content + '}')
                i = k + 1
                continue
            out.append(m.group(0))
        i = m.end()
    out.append(text[i:])
    return ''.join(out)

# \zihao{N} -> pandoc-recognizable size command (ctex sizes)
ZIHAO_MAP = {'0': '\\Huge', '1': '\\huge', '2': '\\LARGE', '3': '\\Large', '4': '\\large', '5': '', '6': '\\small'}

# column spec may contain nested {..} groups (e.g. >{\centering\arraybackslash})
COLSPEC = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
TABULAR_BEGIN = r'\\begin\{tabular\}\s*' + COLSPEC

BAL = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'   # one brace group with one level of nested braces

MATH_SYMBOLS = {
    '\\times': '×', '\\cdot': '·', '\\pm': '±', '\\mp': '∓', '\\div': '÷',
    '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈', '\\equiv': '≡',
    '\\sim': '~', '\\propto': '∝', '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇',
    '\\sum': 'Σ', '\\prod': 'Π', '\\int': '∫', '\\oint': '∮', '\\sqrt': '√',
    '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒',
    '\\Leftarrow': '⇐', '\\Leftrightarrow': '⇔', '\\leftrightarrow': '↔',
    '\\forall': '∀', '\\exists': '∃', '\\in': '∈', '\\notin': '∉', '\\subset': '⊂',
    '\\subseteq': '⊆', '\\cup': '∪', '\\cap': '∩', '\\emptyset': '∅',
    '\\ldots': '…', '\\cdots': '⋯', '\\dots': '…',
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε',
    '\\varepsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\iota': 'ι',
    '\\kappa': 'κ', '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ',
    '\\pi': 'π', '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ',
    '\\phi': 'φ', '\\varphi': 'φ', '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
    '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ', '\\Xi': 'Ξ',
    '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Upsilon': 'Υ', '\\Phi': 'Φ', '\\Psi': 'Ψ', '\\Omega': 'Ω',
}
_MATH_RE = re.compile(
    r'(?:' + '|'.join(re.escape(k) for k in sorted(MATH_SYMBOLS, key=len, reverse=True)) + r')(?![a-zA-Z])')

def de_math(c):
    """Strip LaTeX math delimiters and convert common math macros to readable Unicode."""
    def math_body(s):
        s = re.sub(r'\\frac\s*(' + BAL + r')\s*(' + BAL + r')',
                   lambda m: m.group(1)[1:-1] + '/' + m.group(2)[1:-1], s)
        return _MATH_RE.sub(lambda m: MATH_SYMBOLS[m.group(0)], s)
    c = re.sub(r'\$\$(.*?)\$\$', lambda m: math_body(m.group(1)), c, flags=re.S)
    c = re.sub(r'\$(.*?)\$', lambda m: math_body(m.group(1)), c, flags=re.S)
    c = re.sub(r'\\\[(.*?)\\\]', lambda m: math_body(m.group(1)), c, flags=re.S)
    c = re.sub(r'\\\((.*?)\\\)', lambda m: math_body(m.group(1)), c, flags=re.S)
    return c

def clean_cell(c):
    """Strip LaTeX cell markup -> plain text for a pipe table."""
    # multirow/multicolumn: keep the LAST brace group (the content), which may nest
    c = de_math(c)
    c = re.sub(r'\\multirow\s*\{[^{}]*\}\s*' + BAL + r'\s*(' + BAL + r')', r'\1', c)
    c = re.sub(r'\\multicolumn\s*\{[^{}]*\}\s*' + BAL + r'\s*(' + BAL + r')', r'\1', c)
    c = re.sub(r'\\zihao\{[^}]*\}', ' ', c)
    c = re.sub(r'\\textbf\{([^}]*)\}', r'\1', c)
    c = re.sub(r'\\textit\{([^}]*)\}', r'\1', c)
    c = re.sub(r'\\centering|\\arraybackslash|\\textwidth|\\par', ' ', c)
    c = re.sub(r'\\[a-zA-Z@]+\s*', ' ', c)
    c = c.replace('{', '').replace('}', '').replace('\\', '')
    c = re.sub(r'\s+', ' ', c).strip()
    return c

# \zihao{N} -> points; the cover registration table uses 五号 10.5pt labels and a 四号 14pt bold
# competition name, so the per-cell size has to survive into the Word table XML.
ZIHAO_PT = {'0': 42, '1': 26, '2': 22, '3': 16, '4': 14, '5': 10.5, '6': 7.5, '7': 5.5, '8': 5,
            '-1': 24, '-2': 18, '-3': 15, '-4': 12, '-5': 9, '-6': 7.5}

def split_subsup(s):
    """Split a math-ish cell text like 'R_{max}' / 'x^2' / 'λ_i' into [(text, vert)].
    vert: '' | 'subscript' | 'superscript'. Both {group} and single-char forms handled."""
    segs = []
    buf = []
    n = len(s)
    i = 0
    def flush():
        if buf:
            segs.append((''.join(buf), ''))
            del buf[:]
    while i < n:
        ch = s[i]
        if ch in ('_', '^'):
            vert = 'subscript' if ch == '_' else 'superscript'
            j = i + 1
            if j < n and s[j] == '{':
                depth = 0
                k = j
                while k < n:
                    if s[k] == '{':
                        depth += 1
                    elif s[k] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    k += 1
                body = s[j + 1:k]
                i = k + 1
            elif j < n:
                body = s[j]
                i = j + 1
            else:
                body = ''
                i = n
            flush()
            segs.append((body, vert))
        else:
            buf.append(ch)
            i += 1
    flush()
    return segs

def clean_cell2(c):
    """Strip LaTeX cell markup -> (segments, size_pts_or_None, bold).
    segments = [(text, vert)] where vert: '' | 'subscript' | 'superscript'."""
    c = de_math(c)
    c = re.sub(r'\\multirow\s*\{([^{}]*)\}\s*' + BAL + r'\s*(' + BAL + r')', r'\2', c)
    c = re.sub(r'\\multicolumn\s*\{([^{}]*)\}\s*' + BAL + r'\s*(' + BAL + r')', r'\2', c)
    m = re.search(r'\\zihao\{([0-8]|-[1-6])\}', c)
    size = ZIHAO_PT.get(m.group(1)) if m else None
    bold = bool(re.search(r'\\textbf\{', c))
    c = re.sub(r'\\zihao\{[^}]*\}', ' ', c)
    c = re.sub(r'\\textbf\{([^}]*)\}', r'\1', c)
    c = re.sub(r'\\textit\{([^}]*)\}', r'\1', c)
    c = re.sub(r'\\centering|\\arraybackslash|\\textwidth|\\par', ' ', c)
    c = re.sub(r'\\[a-zA-Z@]+\s*', ' ', c)
    # split sub/superscript into segments BEFORE removing braces so {max} keeps its grouping
    segs = split_subsup(c)
    out = []
    for (txt, vert) in segs:
        t = re.sub(r'\s+', ' ', txt.replace('{', '').replace('}', '').replace('\\', '')).strip()
        if t:
            out.append((t, vert))
    if not out:
        out = [('', '')]
    return out, size, bold

BRACE = r'\{(?:[^{}]|\{[^{}]*\})*\}'

def cell_xml(width, txt, span, vmode, size=None, bold=False):
    """txt = list of (text, vert) segments (from clean_cell2) or a plain string."""
    # tcPr element order matters in OOXML: tcW, gridSpan, vMerge, vAlign
    tcpr = '<w:tcPr><w:tcW w:w="%d" w:type="dxa"/>' % width
    if span > 1:
        tcpr += '<w:gridSpan w:val="%d"/>' % span
    if vmode == 'restart':
        tcpr += '<w:vMerge w:val="restart"/>'
    elif vmode == 'continue':
        tcpr += '<w:vMerge/>'
    tcpr += '<w:vAlign w:val="center"/></w:tcPr>'
    # single line spacing + a little breathing room above/below the text inside cells
    cell_spacing = '<w:spacing w:line="240" w:lineRule="auto" w:before="100" w:after="100"/>'
    if vmode == 'continue':
        return ('<w:tc>' + tcpr + '<w:p><w:pPr>' + cell_spacing + '</w:pPr></w:p></w:tc>')
    segs = txt if isinstance(txt, list) else ([(txt or '', '')] if txt else [('', '')])
    # split into runs; sub/superscript text gets w:vertAlign so it renders as a true sub/superscript
    runs = []
    for (seg_text, vert) in segs:
        if seg_text == '' and not vert:
            continue
        rpr = ''
        if size or bold or vert:
            rpr = '<w:rPr>'
            if size:
                rpr += '<w:sz w:val="%d"/><w:szCs w:val="%d"/>' % (round(float(size) * 2), round(float(size) * 2))
            if bold:
                rpr += '<w:b/><w:bCs/>'
            if vert:
                rpr += '<w:vertAlign w:val="%s"/>' % vert
            rpr += '</w:rPr>'
        runs.append('<w:r>' + rpr + '<w:t xml:space="preserve">' + esc_xml(seg_text) + '</w:t></w:r>')
    if not runs:
        runs.append('<w:r><w:t xml:space="preserve"></w:t></w:r>')
    return ('<w:tc>' + tcpr +
            '<w:p><w:pPr><w:jc w:val="center"/>' + cell_spacing + '</w:pPr>' +
            ''.join(runs) + '</w:p></w:tc>')

def tabular_to_word_xml(body, colspec):
    """Convert a tabular body + colspec into a Word <w:tbl> OpenXML fragment.
    Full borders when the colspec uses '|', otherwise three-line (booktabs) borders.
    Fixed at full text width (9072 twips). Handles \\multicolumn (gridSpan),
    \\multirow (vMerge), longtable head/foot structures and inline \\caption.
    Returns (table_xml, caption_or_None)."""
    ws = re.findall(r'p\{([0-9.]+)', colspec)
    # capture an inline \\caption{...} (longtable puts it inside the body) and drop it from the cells
    cap = None
    cm = re.search(r'\\caption\s*(' + BAL + r')', body, re.S)
    if cm:
        cap = cm.group(1)[1:-1]
        body = body[:cm.start()] + body[cm.end():]
    # drop borders / booktabs rules / longtable head-foot structures / rowcolor / label / macros
    # first remove the repeated-header block (between \endfirsthead and \endhead) entirely
    body = re.sub(r'\\endfirsthead.*?\\endhead', '', body, flags=re.S)
    body2 = re.sub(r'\\hline|\\cline\{[^}]*\}|\\toprule|\\midrule|\\bottomrule|\\cmidrule\{[^}]*\}|\\noalign\{[^}]*\}|\\addlinespace'
                   r'|\\endfirsthead|\\endhead|\\endfoot|\\endlastfoot|\\rowcolor\{[^}]*\}|\\label\{[^}]*\}|\\arraybackslash', '', body)
    raw_rows = [r for r in re.split(r'\\\\', body2) if r.strip()]
    hint = max([len(r.split('&')) for r in raw_rows] or [1])
    if ws:
        total = sum(float(w) for w in ws)
        widths = [max(300, round(float(w) / total * 9072)) for w in ws]
        ncols = len(widths)
    else:
        ncols = hint
        widths = [round(9072 / ncols)] * ncols
    full = '|' in colspec
    if full:
        borders = ('<w:tblBorders>' +
                   ''.join('<w:%s w:val="single" w:sz="4" w:space="0" w:color="000000"/>' % e
                           for e in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV')) +
                   '</w:tblBorders>')
    else:
        borders = ('<w:tblBorders>'
                   '<w:top w:val="single" w:sz="12" w:space="0" w:color="000000"/>'
                   '<w:left w:val="none" w:sz="0" w:space="0"/>'
                   '<w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/>'
                   '<w:right w:val="none" w:sz="0" w:space="0"/>'
                   '<w:insideH w:val="none" w:sz="0" w:space="0"/>'
                   '<w:insideV w:val="none" w:sz="0" w:space="0"/>'
                   '</w:tblBorders>')
    grid = ''.join('<w:gridCol w:w="%d"/>' % w for w in widths)
    vmerge_rest = {}   # column index -> remaining continuation rows
    trs = []
    for row in raw_rows:
        cells = row.split('&')
        tcs = ''
        ci = 0
        for raw_cell in cells:
            cell_txt = raw_cell.strip()
            span = 1
            vmode = None
            # \\multicolumn{n}{spec}{content}
            mcm = re.match(r'\\multicolumn\s*\{(\d+)\}\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*(' + BRACE + r')\s*$', cell_txt, re.S)
            if mcm:
                span = int(mcm.group(1))
                cell_txt = mcm.group(2)[1:-1]
            # \\multirow{n}{w}{content}
            mrm = re.match(r'\\multirow\s*\{(\d+)\}\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*(' + BRACE + r')\s*$', cell_txt, re.S)
            if mrm:
                mspan = int(mrm.group(1))
                cell_txt = mrm.group(2)[1:-1]
                if mspan > 1:
                    vmerge_rest[ci] = mspan - 1
                    vmode = 'restart'
            # vMerge continuation (always emit a continue cell for every spanned row, including the last)
            if ci in vmerge_rest and vmode is None:
                tcs += cell_xml(widths[ci], '', 1, 'continue')
                vmerge_rest[ci] = vmerge_rest[ci] - 1
                if vmerge_rest[ci] <= 0:
                    del vmerge_rest[ci]
                ci += 1
                continue
            segs, zsize, zbold = clean_cell2(cell_txt)
            if ci < ncols:
                tcs += cell_xml(widths[ci], segs, span, vmode, zsize, zbold)
            ci += 1
        # pad remaining columns
        while ci < ncols:
            if ci in vmerge_rest:
                vmerge_rest[ci] -= 1
                if vmerge_rest[ci] <= 0:
                    del vmerge_rest[ci]
            tcs += cell_xml(widths[ci], '', 1, None)
            ci += 1
        trs.append('<w:tr>' + tcs + '</w:tr>')
    xml = ('<w:tbl><w:tblPr><w:tblW w:w="9072" w:type="dxa"/>' + borders + '</w:tblPr>' +
           '<w:tblGrid>' + grid + '</w:tblGrid>' + ''.join(trs) + '</w:tbl>')
    if cap:
        cap = de_math(re.sub(r'\s+', ' ', cap.replace('\\', '').replace('{', '').replace('}', '')).strip())
    return xml, cap

def esc_xml(s):
    return (s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def convert_tabular_to_pipe(text):
    """Replace \\begin{tabular}...\\end{tabular}, \\begin{longtable}...\\end{longtable},
    and their \\begin{table}...\\end{table} wrappers with [[GONGFANG_TBL:<hex>]] markers that
    layout.lua injects as real Word tables. Uses a scanner (balanced braces) so nested colspecs
    and complex bodies are handled robustly."""
    ENVS = ('tabular', 'longtable', 'tabularx')

    def find_balanced_brace(s, pos):
        # s[pos] must be '{'; return index of matching '}'
        depth = 0
        i = pos
        n = len(s)
        while i < n:
            if s[i] == '{':
                depth += 1
            elif s[i] == '}':
                depth -= 1
                if depth == 0:
                    return i
            i += 1
        return -1

    cap_no = [0]  # table caption counter (number captions "表 N")
    def build_table_xml(colspec, body):
        try:
            xml, cap = tabular_to_word_xml(body, colspec)
            marker = '[[GONGFANG_TBL:' + xml.encode('utf-8').hex() + ']]'
            if cap:
                cap_no[0] += 1
                marker = '表 %d %s\n\n%s' % (cap_no[0], cap, marker)
            return marker
        except Exception:
            return colspec + body  # leave as-is on parse failure

    def scan(text):
        out = []
        i = 0
        n = len(text)
        while i < n:
            # find any \begin{ENV}
            found = None
            for env in ENVS:
                idx = text.find('\\begin{' + env + '}', i)
                if idx != -1 and (found is None or idx < found[1]):
                    found = (env, idx)
            if found is None:
                out.append(text[i:])
                break
            env, idx = found[0], found[1]
            out.append(text[i:idx])
            # find the column-spec brace group
            first_brace = text.find('{', idx + len('\\begin{' + env + '}'))
            col_start = first_brace
            if env == 'tabularx':
                # tabularx is \begin{tabularx}{width}{colspec}: skip the width group
                w_end = find_balanced_brace(text, first_brace)
                col_start = w_end + 1
            col_end = find_balanced_brace(text, col_start)
            colspec = text[col_start:col_end + 1]
            # find the matching \end{env}: tables almost never nest, so take the first \end{env}
            body_start = col_end + 1
            end_tag = '\\end{' + env + '}'
            body_end = text.find(end_tag, body_start)
            if body_end == -1:
                out.append(text[idx:idx + len('\\begin{' + env + '}')])
                i = idx + len('\\begin{' + env + '}')
                continue
            body = text[body_start:body_end]
            out.append(build_table_xml(colspec, body))
            i = body_end + len(end_tag)
        return ''.join(out)

    text = scan(text)
    tbl_no = [0]  # table counter for captions (body tables start at 1; cover table is unnumbered)
    # remove \begin{table}...\end{table} wrappers; put the caption as a SEPARATE paragraph ABOVE the table
    def wr_repl(mm):
        inner = mm.group(1)
        cap = None
        cm = re.search(r'\\caption\s*(' + BAL + r')', inner, re.S)
        if cm:
            cap = cm.group(1)[1:-1]
            inner = inner[:cm.start()] + inner[cm.end():]
        marker = re.search(r'\[\[GONGFANG_TBL:[0-9a-f]+\]\]', inner)
        inner = re.sub(r'\\[a-zA-Z@]+', '', inner)
        inner = inner.replace('{', '').replace('}', '').replace('\\', '')
        inner = re.sub(r'\s+', ' ', inner).strip()
        if cap:
            cap = de_math(cap.replace('\\', '').replace('{', '').replace('}', ''))
            cap = re.sub(r'\s+', ' ', cap).strip()
            tbl_no[0] += 1
            caption = '表 %d %s' % (tbl_no[0], cap)
            # caption BEFORE the table marker: pandoc keeps it as a separate paragraph above the table
            inner = caption + '\n\n' + (marker.group(0) if marker else '')
        elif marker:
            inner = marker.group(0)
        return '\n\n' + inner + '\n\n'
    text = re.sub(r'\\begin\{table\}\[[^\]]*\]\s*(.*?)\\end\{table\}', wr_repl, text, flags=re.S)
    # unwrap {\centering <marker> \par} groups so the marker stands alone (cover tables)
    text = re.sub(r'\{\s*\\centering\s*(\[\[GONGFANG_TBL:[0-9a-f]+\]\])\s*\\par\s*\}', r'\1', text)
    return text

def transform(text, fname, i):
    # Convert tabular -> pandoc pipe tables FIRST so they become real Word tables
    text = convert_tabular_to_pipe(text)
    # Cover macros -> drop
    text = re.sub(r'\\(tihao|baominghao|group|schoolname|membera|memberb|memberc|supervisor)\{[^}]*\}', '', text)
    # abstract env -> 摘要 heading
    text = text.replace('\\begin{abstract}', '\\section*{摘要}')
    text = text.replace('\\end{abstract}', '')
    # keywords -> paragraph
    text = re.sub(r'\\keywords\{([^}]*)\}', r'\\par\\noindent\\textbf{关键词：}\1', text)
    # main title (centered + \zihao{3} bold) -> title marker; layout.lua renders it centered + large.
    # Only match title-appropriate sizes ([0-4]); a centered caption block is usually \zihao{5} (五号)
    # and must NOT become a giant centered "title" (the "text after a table turns bold-centered" bug).
    def _looks_caption(t):
        t = t.strip()
        return bool(re.match(r'^(表|图)\s*\d+(\.\d+)*\s*\S', t))
    text = re.sub(r'\{\s*\\centering\s*\\zihao\{([0-4])\}\s*\\bfseries\s*(.*?)\\par\s*\}',
                  lambda mm: (mm.group(0) if _looks_caption(mm.group(2)) else '\\section*{' + TITLE_MARK + ' ' + mm.group(2).strip() + '}'),
                  text, flags=re.S)
    # flowcharts / images
    text = clean_flowcharts(text)
    text = text.replace('\\begin{center}', '\\centering')
    text = text.replace('\\end{center}', '')
    text = re.sub(r'\\includegraphics(\[[^\]]*\])?\{([^}]+)\}',
                  lambda mm: '\\includegraphics[width=0.82\\textwidth]{%s}' % to_abs(mm.group(2)), text)
    # table columns: tabularx -> tabular (keep longtable), record ratios
    def tabularx_repl(mm):
        table_ratios.append(col_ratios(mm.group(2)))
        return '\\begin{tabular}{' + clean_colspec(mm.group(2)) + '}'
    def longtable_repl(mm):
        table_ratios.append(col_ratios(mm.group(1)))
        return '\\begin{longtable}{' + clean_colspec(mm.group(1)) + '}'
    text = re.sub(r'\\begin\{tabularx\}' + '(' + BALANCED_BRACE + ')' + '(' + BALANCED_BRACE + ')',
                  tabularx_repl, text)
    text = text.replace('\\end{tabularx}', '\\end{tabular}')
    text = re.sub(r'\\begin\{longtable\}' + '(' + BALANCED_BRACE + ')', longtable_repl, text)
    # itemize/enumerate optional argument
    text = re.sub(r'\\begin\{(itemize|enumerate)\}\[[^\]]*\]', r'\\begin{\1}', text)
    # makeatletter helper lines (drop only these; keep \section*{附录})
    text = re.sub(r'\\makeatletter\s*', '', text)
    text = re.sub(r'\\makeatother\s*', '', text)
    text = re.sub(r'\\let\\@oldaddcontentsline\\addcontentsline\s*', '', text)
    text = re.sub(r'\\renewcommand\{\\addcontentsline\}\[3\]\{\}\s*', '', text)
    text = re.sub(r'\\let\\addcontentsline\\@oldaddcontentsline\s*', '', text)
    # references: drop env, \bibitem -> [n], \cite -> [n,m]
    text = re.sub(r'\\begin\{thebibliography\}\{[^}]*\}', '', text)
    text = re.sub(r'\\end\{thebibliography\}', '', text)
    # each entry on its own paragraph: blank line before [n]; only match \bibitem at line start
    # so a \bibitem mentioned inside a % comment line is left alone (and then dropped by pandoc)
    text = re.sub(r'(?m)^[ \t]*\\bibitem\{([^}]+)\}',
                  lambda mm: '\n\n[%d] ' % bib_num.get(mm.group(1), 0), text)
    text = re.sub(r'\\cite\{([^}]+)\}', cite_repl, text)
    # longtable repeated header/footer structures
    text = re.sub(r'\\endfirsthead.*?\\endhead', '', text, flags=re.S)
    text = re.sub(r'\\endfirsthead', '', text)
    text = re.sub(r'\\endhead', '', text)
    text = re.sub(r'\\endfoot', '', text)
    text = re.sub(r'\\endlastfoot', '', text)
    # caption numbering
    text = number_captions(text)
    # cross-refs -> numbers
    def ref_repl(mm):
        lab = mm.group(1)
        info = label_map.get(lab)
        return str(info[1]) if info else mm.group(0)
    text = re.sub(r'\\ref\{([^}]+)\}', ref_repl, text)
    text = re.sub(r'\\label\{[^}]*\}', '', text)
    # page controls: keep \\newpage/\\clearpage as markers so layout.lua turns them into real Word page breaks
    text = re.sub(r'\\(thispagestyle|pagestyle)\{[^}]*\}', '', text)
    text = re.sub(r'\\setcounter\{[^}]*\}\{[^}]*\}', '', text)
    text = re.sub(r'\\newpage|\\clearpage', '\n' + PAGE_BREAK_MARK + '\n', text)
    # collapse consecutive page-break markers into one (avoid blank pages)
    text = re.sub(r'(?:' + PAGE_BREAK_MARK + r'\s*){2,}', PAGE_BREAK_MARK + '\n', text)
    # Emit a TOC marker ONLY when the source paper actually requested \tableofcontents;
    # layout.lua inserts a 目录 page only when this marker is present (no phantom TOC).
    text = re.sub(r'\\tableofcontents', '\n\n' + TOC_MARK + '\n\n', text)
    text = re.sub(r'\\zihao\{([0-6])\}', lambda mm: ZIHAO_MAP.get(mm.group(1), ''), text)
    text = re.sub(r'\\song\b', '', text)
    return text

def to_abs(rel):
    """Resolve relative paths (e.g. ../求解/...) to absolute; strip surrounding quotes."""
    rel = rel.strip().strip('"').strip("'")
    if os.path.isabs(rel):
        return rel
    p = os.path.normpath(os.path.join(PAPER, rel))
    return p.replace('\\', '/')

# add 参考文献 heading before the bibliography (by content, not filename)
doc = doc.replace('\\begin{thebibliography}', '\\section*{参考文献}\n\n\\begin{thebibliography}')

# Apply the full transform to the whole document in one pass (document order):
# page breaks, title, flowcharts, captions, references all handled correctly
out = transform(doc, 'merged', 0)
out = re.sub(r'\\maketitle\s*', '', out)  # pandoc doesn't know \maketitle
# If the title marker wasn't produced (unusual paper), prepend the extracted title
if TITLE_MARK not in out and title:
    out = f'\\section*{{{TITLE_MARK} {title}}}\n\n' + out

out_path = os.path.join(WORK, 'merged.tex')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(out)

side = os.path.join(WORK, '工具', 'table_widths.json')
with open(side, 'w', encoding='utf-8') as f:
    json.dump(table_ratios, f, ensure_ascii=False)
print(f'table width ratios {len(table_ratios)} -> {side}')
print('written:', out_path)
print('total chars:', len(out))
