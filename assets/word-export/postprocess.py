#!/usr/bin/env python3
# Gongfang Word export — post-process the generated .docx:
#  0) table cells: clear first-line indent + center horizontally
#  1) "关键词：" runs in 黑体
#  2) table column widths from merge_paper.py's table_widths.json; three-line (booktabs) borders
#  3) equations centered with right-aligned numbers (tab-stop method)
#  4) reference entries: hanging indent
import sys, os, zipfile, shutil, json, re

from lxml import etree

WORK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(WORK)
PAPER_DIR = os.path.join(ROOT, '论文')
target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORK, 'paper.docx')

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
def q(tag):
    return '{%s}%s' % (W, tag)

with zipfile.ZipFile(target) as zin:
    items = {it.filename: zin.read(it.filename) for it in zin.infolist()}

root = etree.fromstring(items['word/document.xml'])

def clear_first_line_indent(ppr):
    ind = ppr.find(q('ind'))
    if ind is None:
        ind = etree.SubElement(ppr, q('ind'))
    ind.set(q('firstLineChars'), '0')
    ind.set(q('firstLine'), '0')

SPACING = 120  # 0.5 line ≈ 120 twips

def add_spacing(ppr, before, after):
    sp = ppr.find(q('spacing'))
    if sp is None:
        sp = etree.Element(q('spacing'))
        style = ppr.find(q('pStyle'))
        if style is not None:
            style.addnext(sp)
        else:
            ppr.insert(0, sp)
    if before:
        sp.set(q('before'), str(before))
    if after:
        sp.set(q('after'), str(after))

# 0) Table cells: vertical center (vAlign) + horizontally centered content (all tables)
cell_ps = 0
for tc in root.iter(q('tc')):
    tcpr = tc.find(q('tcPr'))
    if tcpr is None:
        tcpr = etree.Element(q('tcPr'))
        tc.insert(0, tcpr)
    va = tcpr.find(q('vAlign'))
    if va is None:
        va = etree.SubElement(tcpr, q('vAlign'))
    va.set(q('val'), 'center')
    for p in tc.iter(q('p')):
        ppr = p.find(q('pPr'))
        if ppr is None:
            ppr = etree.Element(q('pPr'))
            p.insert(0, ppr)
        clear_first_line_indent(ppr)
        jc = ppr.find(q('jc'))
        if jc is None:
            jc = etree.Element(q('jc'))
            ind = ppr.find(q('ind'))
            if ind is not None:
                ind.addnext(jc)
            else:
                style = ppr.find(q('pStyle'))
                if style is not None:
                    style.addnext(jc)
                else:
                    ppr.insert(0, jc)
        # all table cells: horizontally centered (regardless of the LaTeX source)
        jc.set(q('val'), 'center')
        # single line spacing inside cells (not inherit the body's line spacing)
        sp = ppr.find(q('spacing'))
        if sp is None:
            sp = etree.Element(q('spacing'))
            ind = ppr.find(q('ind'))
            if ind is not None:
                ind.addprevious(sp)
            else:
                style_el2 = ppr.find(q('pStyle'))
                if style_el2 is not None:
                    style_el2.addnext(sp)
                else:
                    ppr.insert(0, sp)
        sp.set(q('line'), '240')
        sp.set(q('lineRule'), 'auto')
        cell_ps += 1

# 1) "关键词：" -> 黑体
changed = 0
for r in root.iter(q('r')):
    texts = r.findall('.//' + q('t'))
    content = ''.join(t.text or '' for t in texts)
    if content == '关键词：':
        rpr = r.find(q('rPr'))
        if rpr is None:
            rpr = etree.Element(q('rPr'))
            r.insert(0, rpr)
        rf = rpr.find(q('rFonts'))
        if rf is None:
            rf = etree.SubElement(rpr, q('rFonts'))
        rf.set(q('eastAsia'), '黑体')
        changed += 1

# 2) Table column widths (text width 16cm = 9072 twips) + three-line borders
TEXT_W = 9072
ratios_list = json.load(open(os.path.join(WORK, '工具', 'table_widths.json'), encoding='utf-8'))
tbl_count = 0
for ti, tbl in enumerate(root.iter(q('tbl'))):
    if ti >= len(ratios_list):
        break
    ratios = [r for r in ratios_list[ti] if r and r > 0]
    if not ratios:
        continue
    s = sum(ratios)
    widths = [round(r / s * TEXT_W) for r in ratios]
    grid = tbl.find(q('tblGrid'))
    if grid is None:
        continue
    cols = grid.findall(q('gridCol'))
    for j, col in enumerate(cols):
        if j < len(widths):
            col.set(q('w'), str(widths[j]))
    tblpr = tbl.find(q('tblPr'))
    if tblpr is not None:
        tblw = tblpr.find(q('tblW'))
        if tblw is None:
            tblw = etree.Element(q('tblW'))
            style = tblpr.find(q('tblStyle'))
            if style is not None:
                style.addnext(tblw)
            else:
                tblpr.insert(0, tblw)
        tblw.set(q('type'), 'dxa')
        tblw.set(q('w'), str(sum(widths)))
        old = tblpr.find(q('tblBorders'))
        if old is not None:
            tblpr.remove(old)
        tb = etree.Element(q('tblBorders'))
        for tag, val in (('top', 'single'), ('left', 'none'), ('bottom', 'single'),
                         ('right', 'none'), ('insideH', 'none'), ('insideV', 'none')):
            e = etree.SubElement(tb, q(tag))
            e.set(q('val'), val)
            e.set(q('sz'), '12' if val == 'single' else '0')
            e.set(q('space'), '0')
            e.set(q('color'), '000000')
        tblw.addnext(tb)
        # header-row bottom border
        for tr in tbl.findall(q('tr')):
            if tr.find(q('trPr')) is not None and tr.find(q('trPr')).find(q('tblHeader')) is not None:
                for tc in tr.findall(q('tc')):
                    tcpr = tc.find(q('tcPr'))
                    if tcpr is None:
                        tcpr = etree.Element(q('tcPr'))
                        tc.insert(0, tcpr)
                    bd = etree.SubElement(tcpr, q('tcBorders'))
                    bottom = etree.SubElement(bd, q('bottom'))
                    bottom.set(q('val'), 'single')
                    bottom.set(q('sz'), '8')
                    bottom.set(q('space'), '0')
                    bottom.set(q('color'), '000000')
    tbl_count += 1

# 3) Equations: centered + right-aligned number (tab-stop method); numbers written in oMathPara order
eq_fixed = 0
for p in root.iter(q('p')):
    om = p.find('.//{%s}oMathPara' % M)
    if om is None:
        continue
    eq_fixed += 1
    ppr = p.find(q('pPr'))
    if ppr is None:
        ppr = etree.Element(q('pPr'))
        p.insert(0, ppr)
    clear_first_line_indent(ppr)
    tabs = ppr.find(q('tabs'))
    if tabs is None:
        tabs = etree.Element(q('tabs'))
        ind = ppr.find(q('ind'))
        if ind is not None:
            ind.addprevious(tabs)
        else:
            style = ppr.find(q('pStyle'))
            if style is not None:
                style.addnext(tabs)
            else:
                ppr.insert(0, tabs)
    else:
        for tab in list(tabs):
            tabs.remove(tab)
    ct = etree.SubElement(tabs, q('tab'))
    ct.set(q('val'), 'center')
    ct.set(q('pos'), str(TEXT_W // 2))
    rt = etree.SubElement(tabs, q('tab'))
    rt.set(q('val'), 'right')
    rt.set(q('pos'), str(TEXT_W))
    ompr = om.find('{%s}oMathParaPr' % M)
    if ompr is not None:
        jc = ompr.find('{%s}jc' % M)
        if jc is not None:
            ompr.remove(jc)
    tr1 = etree.Element(q('r'))
    etree.SubElement(tr1, q('tab'))
    om.addprevious(tr1)
    tr2 = etree.Element(q('r'))
    etree.SubElement(tr2, q('tab'))
    om.addnext(tr2)
    numrun = etree.Element(q('r'))
    numtxt = etree.SubElement(numrun, q('t'))
    numtxt.text = '(%d)' % eq_fixed
    tr2.addnext(numrun)

# 4) Reference entries: hanging indent (first line flush, continuation indented 2 chars)
ref_count = 0
in_refs = False
for p in root.iter(q('p')):
    texts = p.findall('.//' + q('t'))
    content = ''.join(t.text or '' for t in texts)
    style = p.find('.//' + q('pStyle'))
    is_h1 = style is not None and style.get(q('val')) == 'Heading1'
    if is_h1:
        if '参考文献' in content:
            in_refs = True
            continue
        if '附录' in content:
            in_refs = False
            continue
    if in_refs:
        ppr = p.find(q('pPr'))
        if ppr is None:
            ppr = etree.Element(q('pPr'))
            p.insert(0, ppr)
        ind = ppr.find(q('ind'))
        if ind is None:
            ind = etree.Element(q('ind'))
            spacing = ppr.find(q('spacing'))
            if spacing is not None:
                spacing.addnext(ind)
            else:
                ppr.insert(0, ind)
        ind.set(q('firstLineChars'), '0')
        ind.set(q('firstLine'), '0')
        ind.set(q('hangingChars'), '200')
        ind.set(q('hanging'), '480')
        ref_count += 1

# 5) Spacing around figures / captions / equations / tables (0.5 line, not flush with body text)
sp_img = sp_cap = sp_eq = sp_tbl = 0
for p in root.iter(q('p')):
    # image paragraph (contains a drawing)
    if p.find('.//' + q('drawing')) is not None:
        ppr = p.find(q('pPr'))
        if ppr is None:
            ppr = etree.Element(q('pPr')); p.insert(0, ppr)
        clear_first_line_indent(ppr)  # don't inherit the body's first-line indent on images
        add_spacing(ppr, SPACING, 60)
        sp_img += 1
        continue
    # equation paragraph
    if p.find('.//{%s}oMathPara' % M) is not None:
        ppr = p.find(q('pPr'))
        if ppr is None:
            ppr = etree.Element(q('pPr')); p.insert(0, ppr)
        add_spacing(ppr, SPACING, SPACING)
        sp_eq += 1
        continue
    # caption paragraph (图/表 N prefix, or ImageCaption/TableCaption style)
    texts = p.findall('.//' + q('t'))
    content = ''.join(t.text or '' for t in texts)
    style_el = p.find('.//' + q('pStyle'))
    style_val = style_el.get(q('val')) if style_el is not None else ''
    is_cap = style_val in ('ImageCaption', 'TableCaption') or bool(re.match(r'^(图|表)\s*\d+', content.strip()))
    if is_cap:
        ppr = p.find(q('pPr'))
        if ppr is None:
            ppr = etree.Element(q('pPr')); p.insert(0, ppr)
        add_spacing(ppr, 60, SPACING)
        sp_cap += 1
# spacing around tables (paragraph right before / after each <w:tbl>)
for tbl in root.iter(q('tbl')):
    prev = tbl.getprevious()
    nxt = tbl.getnext()
    if prev is not None and prev.tag == q('p'):
        ppr = prev.find(q('pPr'))
        if ppr is None:
            ppr = etree.Element(q('pPr')); prev.insert(0, ppr)
        add_spacing(ppr, None, SPACING)
        sp_tbl += 1
    if nxt is not None and nxt.tag == q('p'):
        ppr = nxt.find(q('pPr'))
        if ppr is None:
            ppr = etree.Element(q('pPr')); nxt.insert(0, ppr)
        add_spacing(ppr, SPACING, None)
        sp_tbl += 1

# 7) TOC page numbers: best-effort from 论文.pdf so page numbers show in any viewer,
#    not only after Word updates the field
def strip_num_prefix(txt):
    m = re.match(r'^[一二三四五六七八九十]+、\s*', txt)
    if m:
        return txt[m.end():].strip()
    m = re.match(r'^[\d.]+\.?\s*', txt)
    if m:
        return txt[m.end():].strip()
    return txt.strip()

toc_pages = 0
try:
    import fitz
    pdf_path = os.path.join(PAPER_DIR, '论文.pdf')
    entries = []
    for p in root.iter(q('p')):
        ppr = p.find(q('pPr'))
        if ppr is None:
            continue
        tabs = ppr.find(q('tabs'))
        if tabs is None:
            continue
        has_dot = any((t.get(q('val')) == 'right' and t.get(q('leader')) == 'dot') for t in tabs)
        if not has_dot:
            continue
        texts = p.findall('.//' + q('t'))
        heading = ''.join(t.text or '' for t in texts).strip()
        if heading and heading != '目录':
            entries.append((p, heading))
    if entries and os.path.exists(pdf_path):
        pd = fitz.open(pdf_path)
        heads_clean = [strip_num_prefix(h) for _, h in entries]
        pmap = {}
        for pi in range(len(pd)):
            page_text = pd[pi].get_text()
            for i, clean in enumerate(heads_clean):
                if clean and clean not in pmap and clean in page_text:
                    pmap[clean] = pi + 1
        pd.close()
        # the Word body restarts page numbering at 1 from 引言 (first TOC entry).
        # shift the PDF-estimated pages by the offset so the TOC numbers match the body numbering.
        offset = 0
        if heads_clean and heads_clean[0] in pmap:
            offset = pmap[heads_clean[0]] - 1
        for (p, heading), clean in zip(entries, heads_clean):
            page = pmap.get(clean)
            if page is None:
                continue
            word_page = max(1, page - offset)
            for r in p.findall(q('r')):
                if r.find(q('tab')) is not None:
                    newr = etree.Element(q('r'))
                    rpr = etree.SubElement(newr, q('rPr'))
                    etree.SubElement(rpr, q('sz')).set(q('val'), '22')
                    etree.SubElement(rpr, q('szCs')).set(q('val'), '22')
                    t = etree.SubElement(newr, q('t'))
                    t.text = ' ' + str(word_page)
                    r.addnext(newr)
                    toc_pages += 1
                    break
except Exception:
    pass

# 8) Section-based page numbering: cover (no page number) / TOC (Roman) / body (Arabic from 1)
R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL_FOOTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer'
try:
    # ---- three footers ----
    def footer_part(inner):
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:ftr xmlns:w="' + W + '" xmlns:r="' + R_NS + '">' + inner + '</w:ftr>').encode('utf-8')
    def page_field(txt):
        return ('<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
                '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
                '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
                '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
                '<w:r><w:t>' + txt + '</w:t></w:r>'
                '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>')
    items['word/footer1.xml'] = footer_part('<w:p/>')           # cover: empty (no page number)
    items['word/footer2.xml'] = footer_part(page_field('I'))    # TOC: Roman
    items['word/footer3.xml'] = footer_part(page_field('1'))    # body: Arabic

    # ---- relationships for the three footers ----
    rels = etree.fromstring(items['word/_rels/document.xml.rels'])
    REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
    rids = {}
    def new_rid():
        ids = [int(r.get('Id')[3:]) for r in rels if (r.get('Id') or '').startswith('rId')]
        return 'rId%d' % ((max(ids) + 1) if ids else 1)
    for fn in ('footer1.xml', 'footer2.xml', 'footer3.xml'):
        rid = new_rid()
        rel = etree.SubElement(rels, '{%s}Relationship' % REL)
        rel.set('Id', rid)
        rel.set('Type', REL_FOOTER)
        rel.set('Target', fn)
        rids[fn] = rid
    items['word/_rels/document.xml.rels'] = etree.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)

    # ---- content types for footer1/2/3 ----
    ct = etree.fromstring(items['[Content_Types].xml'])
    CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
    for fn in ('footer1.xml', 'footer2.xml', 'footer3.xml'):
        if not any(o.get('PartName') == '/word/' + fn for o in ct):
            oe = etree.SubElement(ct, '{%s}Override' % CT)
            oe.set('PartName', '/word/' + fn)
            oe.set('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml')
    items['[Content_Types].xml'] = etree.tostring(ct, xml_declaration=True, encoding='UTF-8', standalone=True)

    # ---- find the body start (引言: first numbered level-1 heading, text like "一、…") ----
    paras = list(root.iter(q('p')))
    body_p = None
    for p in paras:
        texts = p.findall('.//' + q('t'))
        txt = ''.join(x.text or '' for x in texts).strip()
        has_pb = p.find('.//' + q('pageBreakBefore')) is not None
        if has_pb and re.match(r'^[一二三四五六七八九十]+、', txt):
            body_p = p
            break

    # body (final) sectPr: Arabic footer, restart at 1; also the source of page geometry
    secs_all = root.findall('.//' + q('sectPr'))
    body_sec = secs_all[-1] if secs_all else None  # the document's final sectPr (end of w:body)
    pg_sz = body_sec.find(q('pgSz')) if body_sec is not None else None
    pg_mar = body_sec.find(q('pgMar')) if body_sec is not None else None

    def clone(el):
        return etree.fromstring(etree.tostring(el)) if el is not None else None

    # section-break paragraph (zero-height) whose pPr sectPr describes the section it ends.
    # w:type=continuous: the next section's first paragraph already carries pageBreakBefore,
    # so a nextPage break would stack two breaks and add a blank page.
    # pgSz/pgMar are copied from the body section so the cover page size stays identical.
    def section_break(footer_rid, pgtype):
        sp = etree.Element(q('p'))
        ppr = etree.SubElement(sp, q('pPr'))
        spc = etree.SubElement(ppr, q('spacing'))
        spc.set(q('line'), '0'); spc.set(q('lineRule'), 'exact')
        sec = etree.SubElement(ppr, q('sectPr'))
        tp = etree.SubElement(sec, q('type'))
        tp.set(q('val'), 'continuous')
        if pg_sz is not None:
            sec.append(clone(pg_sz))
        if pg_mar is not None:
            sec.append(clone(pg_mar))
        fr = etree.SubElement(sec, q('footerReference'))
        fr.set('{%s}id' % R_NS, footer_rid)
        fr.set(q('type'), 'default')
        if pgtype:
            pg = etree.SubElement(sec, q('pgNumType'))
            for k, v in pgtype.items():
                pg.set(q(k), str(v))
        return sp

    # cover section ends before 引言 (empty footer, no page number on cover/摘要)
    if body_p is not None:
        body_p.addprevious(section_break(rids['footer1.xml'], {'fmt': 'none'}))

    if body_sec is not None:
        for fr in body_sec.findall(q('footerReference')):
            body_sec.remove(fr)
        fr = etree.Element(q('footerReference'))
        fr.set('{%s}id' % R_NS, rids['footer3.xml'])
        fr.set(q('type'), 'default')
        body_sec.insert(0, fr)
        old_pg = body_sec.find(q('pgNumType'))
        if old_pg is not None:
            body_sec.remove(old_pg)
        pg = etree.SubElement(body_sec, q('pgNumType'))
        pg.set(q('start'), '1')
except Exception:
    pass

# 9) Figure/table captions: 宋体 + bold (Song, not 黑体)
sp_cap_font = 0
for p in root.iter(q('p')):
    texts = p.findall('.//' + q('t'))
    content = ''.join(t.text or '' for t in texts)
    style_el = p.find('.//' + q('pStyle'))
    style_val = style_el.get(q('val')) if style_el is not None else ''
    if style_val in ('ImageCaption', 'TableCaption') or bool(re.match(r'^(图|表)\s*\d+', content.strip())):
        # center the caption paragraph, and don't inherit the body's first-line indent
        ppr_c = p.find(q('pPr'))
        if ppr_c is None:
            ppr_c = etree.Element(q('pPr')); p.insert(0, ppr_c)
        clear_first_line_indent(ppr_c)
        jc_c = ppr_c.find(q('jc'))
        if jc_c is None:
            jc_c = etree.SubElement(ppr_c, q('jc'))
        jc_c.set(q('val'), 'center')
        for r in p.findall('.//' + q('r')):
            rpr = r.find(q('rPr'))
            if rpr is None:
                rpr = etree.Element(q('rPr')); r.insert(0, rpr)
            rf = rpr.find(q('rFonts'))
            if rf is None:
                rf = etree.SubElement(rpr, q('rFonts'))
            # 宋体 everywhere so the caption (and anything after it) is not 黑体
            rf.set(q('ascii'), '宋体')
            rf.set(q('hAnsi'), '宋体')
            rf.set(q('eastAsia'), '宋体')
            rf.set(q('cs'), '宋体')
            if rpr.find(q('b')) is None:
                etree.SubElement(rpr, q('b'))
            if rpr.find(q('bCs')) is None:
                etree.SubElement(rpr, q('bCs'))
        sp_cap_font += 1

items['word/document.xml'] = etree.tostring(root, xml_declaration=True,
                                            encoding='UTF-8', standalone=True)

# settings.xml: tell Word to refresh fields on open so the TOC page numbers fill in automatically
if 'word/settings.xml' in items:
    try:
        sroot = etree.fromstring(items['word/settings.xml'])
        if sroot.find(q('updateFields')) is None:
            uf = etree.Element(q('updateFields'))
            uf.set(q('val'), 'true')
            sroot.insert(0, uf)
        items['word/settings.xml'] = etree.tostring(sroot, xml_declaration=True,
                                                    encoding='UTF-8', standalone=True)
    except Exception:
        pass

# 10) TOC styles: Word rebuilds the TOC field on open (updateFields=true); with no TOC1/2/3 styles
#     defined it falls back to Normal-derived defaults that inherit firstLineChars=200, so every
#     entry gets a 2-char first-line indent. Define the styles with firstLineChars=0 + per-level
#     left indent so the generated 目录 is flush-left (levels 2/3 get their left offset).
TOC_META = {'TOC1': (0, 24, True), 'TOC2': (420, 22, False), 'TOC3': (840, 22, False)}
toc_styles = 0
if 'word/styles.xml' in items:
    try:
        sroot = etree.fromstring(items['word/styles.xml'])
        have = {s.get(q('styleId')) for s in sroot.findall(q('style'))}
        for sid, (left, sz, bold) in TOC_META.items():
            if sid in have:
                continue
            st = etree.SubElement(sroot, q('style'))
            st.set(q('type'), 'paragraph')
            st.set(q('styleId'), sid)
            etree.SubElement(st, q('name')).set(q('val'), 'toc ' + sid[-1])
            etree.SubElement(st, q('basedOn')).set(q('val'), 'Normal')
            etree.SubElement(st, q('next')).set(q('val'), 'Normal')
            ind = etree.SubElement(etree.SubElement(st, q('pPr')), q('ind'))
            ind.set(q('left'), str(left))
            ind.set(q('firstLineChars'), '0')
            ind.set(q('firstLine'), '0')
            rpr = etree.SubElement(st, q('rPr'))
            etree.SubElement(rpr, q('sz')).set(q('val'), str(sz))
            etree.SubElement(rpr, q('szCs')).set(q('val'), str(sz))
            if bold:
                etree.SubElement(rpr, q('b'))
                etree.SubElement(rpr, q('bCs'))
            toc_styles += 1
        items['word/styles.xml'] = etree.tostring(sroot, xml_declaration=True,
                                                  encoding='UTF-8', standalone=True)
    except Exception:
        pass
tmp = target + '.tmp'
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for name, data in items.items():
        zout.writestr(name, data)
shutil.move(tmp, target)
print(f'postprocess done: {changed} keywords bold, {cell_ps} cell paragraphs centered+valign, '
      f'{tbl_count} table widths, {eq_fixed} equation numbers, {ref_count} ref hanging indents, '
      f'{sp_img} images spaced, {sp_cap} captions spaced, {sp_eq} equations spaced, '
      f'{sp_tbl} table gaps, {toc_pages} toc page numbers, {toc_styles} toc styles -> {target}')
