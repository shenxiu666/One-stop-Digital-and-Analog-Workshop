-- Gongfang Word export — layout filter.
--  1) Numbered headings: level 1 gets Chinese-number prefix ("一、"), deeper levels numeric ("1.1", "1.1.1")
--  2) "关键词：" bold character style
--  3) Insert a TOC before the first numbered level-1 heading. The TOC field's cached result is
--     pre-filled with all headings (level 1-3) so it displays immediately in Word;
--     press F9 / Ctrl+A → F9 to refresh page numbers.
--  4) Heading "GONGFANG_TITLE <text>" -> centered, large, bold title paragraph (main paper title)
--  5) Paragraph "GONGFANG_PAGEBREAK" -> real Word page break
--  (Equation numbers are written right-aligned by postprocess.py)

local ctr = {0, 0, 0, 0, 0, 0}
local CN = {'一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'}
local TITLE_MARK = 'GONGFANG_TITLE'
local PAGE_BREAK_MARK = 'GONGFANG_PAGEBREAK'
local TOC_MARK = 'GONGFANG_TOC'
local TOC_STYLES = {[1] = 'TOC1', [2] = 'TOC2', [3] = 'TOC3'}

local function esc(s)
  return (s or ''):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;')
end

local function is_unnumbered(h)
  local classes = (h.attr or {}).classes or {}
  for _, c in ipairs(classes) do
    if c == 'unnumbered' then return true end
  end
  return false
end

local function page_break()
  -- zero line height so the page-break paragraph does not show a blank line
  return pandoc.RawBlock('openxml',
    '<w:p><w:pPr><w:spacing w:line="0" w:lineRule="exact"/></w:pPr>' ..
    '<w:r><w:br w:type="page"/></w:r></w:p>')
end

local function title_paragraph(text)
  -- centered, large (18pt), bold; clear the first-line indent so the title is truly centered
  -- (the reference-doc Normal style carries firstLineChars=200, which a centered title would inherit)
  return pandoc.RawBlock('openxml',
    '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/>' ..
    '<w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr>' ..
    '<w:r><w:rPr><w:sz w:val="36"/><w:szCs w:val="36"/><w:b/><w:bCs/></w:rPr>' ..
    '<w:t xml:space="preserve">' .. esc(text) .. '</w:t></w:r></w:p>')
end

local function hex_to_str(hex)
  local out = {}
  for i = 1, #hex, 2 do
    local byte = tonumber(hex:sub(i, i + 1), 16)
    if byte then out[#out + 1] = string.char(byte) end
  end
  return table.concat(out)
end

function Para(el)
  local ptext = pandoc.utils.stringify(el.content)
  -- table caption [[GONGFANG_CAP:<hex>]] -> centered 宋体 bold caption paragraph (ABOVE the table)
  local cmark = ptext:match('^%[%[GONGFANG_CAP:([0-9a-f]+)%]%]$')
  if cmark then
    local ctext = hex_to_str(cmark)
    return pandoc.RawBlock('openxml',
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:line="240" w:lineRule="auto" w:before="100" w:after="100"/>' ..
      '<w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr>' ..
      '<w:r><w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/><w:b/><w:bCs/></w:rPr>' ..
      '<w:t xml:space="preserve">' .. esc(ctext) .. '</w:t></w:r></w:p>')
  end
  -- table marker [[GONGFANG_TBL:<hex>]] -> real Word table (raw OpenXML from merge_paper.py)
  local tmark = ptext:match('^%[%[GONGFANG_TBL:([0-9a-f]+)%]%]$')
  if tmark then
    return pandoc.RawBlock('openxml', hex_to_str(tmark))
  end
  -- page-break marker -> real Word page break
  if #el.content == 1 and el.content[1].t == 'Str' and el.content[1].text == PAGE_BREAK_MARK then
    return { page_break() }
  end
  -- "关键词：" bold
  for i, c in ipairs(el.content) do
    local txt
    if c.t == 'Str' and c.text == '关键词：' then
      txt = c.text
    elseif c.t == 'Strong' and #c.content == 1
           and c.content[1].t == 'Str' and c.content[1].text == '关键词：' then
      txt = c.content[1].text
    end
    if txt then
      el.content[i] = pandoc.Span(txt, pandoc.Attr('', {'关键词'}))
      break
    end
  end
  return el
end

function Header(h)
  -- title marker -> centered large title paragraph (not numbered, not in TOC)
  if h.level == 1 then
    local txt = pandoc.utils.stringify(h.content)
    local prefix = TITLE_MARK .. ' '
    if txt:sub(1, #prefix) == prefix then
      return title_paragraph(txt:sub(#prefix + 1))
    end
  end
  if h.level < 1 or h.level > 6 then return nil end
  if is_unnumbered(h) then return nil end

  ctr[h.level] = ctr[h.level] + 1
  for i = h.level + 1, 6 do ctr[i] = 0 end
  local prefix
  if h.level == 1 then
    prefix = (CN[ctr[1]] or tostring(ctr[1])) .. '、'
  else
    local parts = {}
    for i = 1, h.level do parts[i] = tostring(ctr[i]) end
    prefix = table.concat(parts, '.') .. ' '
  end
  table.insert(h.content, 1, pandoc.Str(prefix))
  return h
end

-- Build the TOC field XML. The field begin/instr/separate live in the first entry's paragraph
-- and the field end in the last entry's paragraph, so no extra empty paragraphs appear.
-- Each entry: per-level left indent + a right-aligned tab with dot leader at the text edge
-- (Word refreshes the page numbers on open because postprocess.py sets updateFields=true).
local function toc_field_blocks(entries)
  local blocks = {}
  if #entries == 0 then
    blocks[#blocks + 1] = pandoc.RawBlock('openxml',
      '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' ..
      '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' ..
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' ..
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>')
    return blocks
  end
  -- per-level: indentation (TOC1/2/3) and font size (half-points) for a clear hierarchy
  local INDENT = {[1] = 0, [2] = 420, [3] = 840}
  local FONT_SZ = {[1] = 24, [2] = 22, [3] = 22}   -- TOC1 bold 12pt, TOC2/3 11pt
  for idx, e in ipairs(entries) do
    local left = INDENT[e.level] or 0
    local sz = FONT_SZ[e.level] or 22
    local bold = (e.level == 1) and '<w:b/><w:bCs/>' or ''
    local para = '<w:p><w:pPr>' ..
      '<w:tabs><w:tab w:val="right" w:pos="9072" w:leader="dot"/></w:tabs>' ..
      '<w:ind w:left="' .. left .. '" w:firstLineChars="0" w:firstLine="0"/></w:pPr>'
    if idx == 1 then
      para = para ..
        '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' ..
        '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' ..
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    end
    para = para ..
      '<w:r><w:rPr><w:sz w:val="' .. sz .. '"/><w:szCs w:val="' .. sz .. '"/>' .. bold .. '</w:rPr>' ..
      '<w:t xml:space="preserve">' .. esc(e.text) .. '</w:t></w:r>' ..
      '<w:r><w:rPr><w:sz w:val="' .. sz .. '"/><w:szCs w:val="' .. sz .. '"/></w:rPr><w:tab/></w:r>'
    if idx == #entries then
      para = para .. '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    end
    para = para .. '</w:p>'
    blocks[#blocks + 1] = pandoc.RawBlock('openxml', para)
  end
  return blocks
end

-- heading paragraph with pageBreakBefore (starts a new page without a separate page-break paragraph,
-- so there is no blank first line on the new page)
local function heading_raw(level, text, style_override)
  local style = style_override or ({[1]='Heading1',[2]='Heading2',[3]='Heading3'})[level] or 'Heading1'
  return pandoc.RawBlock('openxml',
    '<w:p><w:pPr><w:pStyle w:val="' .. style .. '"/><w:pageBreakBefore/></w:pPr>' ..
    '<w:r><w:t xml:space="preserve">' .. esc(text) .. '</w:t></w:r></w:p>')
end

-- 目录 page (centered bold "目录") + an EMPTY TOC field the user refreshes with F9.
-- Only emitted when the source paper actually had \tableofcontents (see merge_paper.py's GONGFANG_TOC).
local function toc_page_blocks()
  return {
    pandoc.RawBlock('openxml',
      '<w:p><w:pPr><w:pageBreakBefore/><w:jc w:val="center"/><w:spacing w:after="240"/>' ..
      '<w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr>' ..
      '<w:r><w:rPr><w:sz w:val="32"/><w:szCs w:val="32"/><w:b/><w:bCs/></w:rPr>' ..
      '<w:t xml:space="preserve">目录</w:t></w:r></w:p>'),
    pandoc.RawBlock('openxml',
      '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' ..
      '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' ..
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' ..
      '<w:r><w:t xml:space="preserve">（右键此处 → 更新域，或 Ctrl+A 后 F9 生成目录）</w:t></w:r>' ..
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'),
  }
end

local function is_pagebreak_block(blk)
  return blk and blk.t == 'RawBlock' and blk.format == 'openxml'
         and (blk.text or ''):find('w:br w:type="page"', 1, true)
end

function Pandoc(doc)
  -- detect an explicit \tableofcontents marker (merge_paper.py emits GONGFANG_TOC only on request)
  local function is_toc_mark(blk)
    return blk and blk.t == 'Para' and pandoc.utils.stringify(blk.content) == TOC_MARK
  end
  local has_toc = false
  for _, blk in ipairs(doc.blocks) do
    if is_toc_mark(blk) then has_toc = true break end
  end

  -- find the first numbered level-1 heading (引言) to mark the body start
  local insert_at = nil
  for i, blk in ipairs(doc.blocks) do
    if blk.t == 'Header' and blk.level == 1 and not is_unnumbered(blk) then
      insert_at = i
      break
    end
  end
  if insert_at then
    -- 引言 -> pageBreakBefore heading (body starts on a new page, no blank line)
    local intro_txt = pandoc.utils.stringify(doc.blocks[insert_at].content)
    local intro_raw = heading_raw(1, intro_txt)
    local cursor = insert_at
    while cursor > 1 and is_pagebreak_block(doc.blocks[cursor - 1]) do
      table.remove(doc.blocks, cursor - 1)
      cursor = cursor - 1
    end

    -- insert a 目录 page (empty TOC field, refreshed with F9) ONLY when the paper had \tableofcontents
    local out = {}
    for i = 1, cursor - 1 do
      if not is_toc_mark(doc.blocks[i]) then out[#out + 1] = doc.blocks[i] end
    end
    if has_toc then
      for _, b in ipairs(toc_page_blocks()) do out[#out + 1] = b end
    end
    out[#out + 1] = intro_raw
    for i = cursor + 1, #doc.blocks do
      if not is_toc_mark(doc.blocks[i]) then out[#out + 1] = doc.blocks[i] end
    end
    doc.blocks = out
  else
    -- no numbered h1: just drop any leftover TOC marker
    local res = {}
    for _, blk in ipairs(doc.blocks) do
      if not is_toc_mark(blk) then res[#res + 1] = blk end
    end
    doc.blocks = res
  end

  -- convert remaining body page-break markers (e.g. before 参考文献/附录) into pageBreakBefore on the next heading
  local result = {}
  local n = #doc.blocks
  local i = 1
  while i <= n do
    local blk = doc.blocks[i]
    if is_pagebreak_block(blk) and i < n and doc.blocks[i + 1].t == 'Header' then
      local nxt = doc.blocks[i + 1]
      result[#result + 1] = heading_raw(nxt.level, pandoc.utils.stringify(nxt.content))
      i = i + 2
    else
      result[#result + 1] = blk
      i = i + 1
    end
  end
  doc.blocks = result
  return doc
end
