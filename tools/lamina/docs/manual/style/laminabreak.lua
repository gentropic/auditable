-- laminabreak.lua — line-break points inside \code, \file and \col.
-- Space Mono doesn't hyphenate, so a long path, file name or expression in running text had no place
-- to break and stuck out into the margin. Text set by those macros carries the `laminacode` attribute;
-- before the paragraph is broken into lines this walks it and puts a penalty (a permitted break, no
-- hyphen drawn) after a path or name separator, and before an opening bracket. Breaks after a slash are
-- the cheapest; the others cost a little more, so a line prefers to break at a word space.
local attr   = luatexbase.attributes.laminacode
local GLYPH  = node.id('glyph')
local after  = { [0x2F] = 60,   -- /
                 [0x5C] = 60,   -- \
                 [0x2E] = 120,  -- .
                 [0x5F] = 120,  -- _
                 [0x2C] = 80,   -- ,
                 [0x3D] = 120,  -- =
                 [0x3A] = 120,  -- :
                 [0x3B] = 80,   -- ;
                 [0x26] = 120,  -- &
                 [0x3F] = 120,  -- ?
                 [0x2D] = 120,  -- -
                 [0x7C] = 120,  -- |
                 [0x2192] = 80, -- →
               }
local before = { [0x28] = 150, [0x5B] = 150, [0x7B] = 150 }   -- ( [ {

local function addbreaks(head)
  local n = head
  while n do
    local nx = n.next
    if n.id == GLYPH and node.has_attribute(n, attr) then
      local p = after[n.char]
      -- no break right at the end of the code run (the next node must be more of it)
      if p and nx and nx.id == GLYPH and node.has_attribute(nx, attr) then
        local pen = node.new('penalty'); pen.penalty = p
        head = node.insert_after(head, n, pen)
      end
      local q = before[n.char]
      local pv = n.prev
      if q and pv and pv.id == GLYPH and node.has_attribute(pv, attr) and not after[pv.char] then
        local pen = node.new('penalty'); pen.penalty = q
        head = node.insert_before(head, n, pen)
      end
    end
    n = nx
  end
  return head
end

luatexbase.add_to_callback('pre_linebreak_filter', addbreaks, 'lamina.codebreaks')
