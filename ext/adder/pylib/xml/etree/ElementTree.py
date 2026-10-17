"""Lightweight XML support: the ElementTree API (adder's own implementation).

Element / SubElement / ElementTree, parsing (fromstring, XML, parse, XMLParser, TreeBuilder,
XMLPullParser, iterparse) with namespaces expanded to {uri}local as expat does, serialization
(tostring, write, register_namespace, indent) and the ElementPath subset of find / findall.
"""

import re
import io

__all__ = [
    "Comment", "dump", "Element", "ElementTree", "fromstring", "fromstringlist", "indent",
    "iselement", "iterparse", "parse", "ParseError", "PI", "ProcessingInstruction", "QName",
    "SubElement", "tostring", "tostringlist", "TreeBuilder", "VERSION", "XML", "XMLID",
    "XMLParser", "XMLPullParser", "register_namespace", "canonicalize",
]

VERSION = "1.3.0"


class ParseError(SyntaxError):
    pass


def iselement(element):
    return hasattr(element, "tag")


class Element:
    tag = None
    attrib = None
    text = None
    tail = None

    def __init__(self, tag, attrib={}, **extra):
        if not isinstance(attrib, dict):
            raise TypeError("attrib must be dict, not %s" % (attrib.__class__.__name__,))
        self.tag = tag
        self.attrib = {**attrib, **extra}
        self._children = []

    def __repr__(self):
        return "<%s %r at %#x>" % (self.__class__.__name__, self.tag, id(self))

    def makeelement(self, tag, attrib):
        return self.__class__(tag, attrib)

    def __copy__(self):
        elem = self.makeelement(self.tag, self.attrib)
        elem.text = self.text
        elem.tail = self.tail
        elem[:] = self
        return elem

    def copy(self):
        return self.__copy__()

    def __len__(self):
        return len(self._children)

    def __bool__(self):
        return len(self._children) != 0

    def __getitem__(self, index):
        return self._children[index]

    def __setitem__(self, index, element):
        if isinstance(index, slice):
            element = list(element)
            for elt in element:
                self._assert_is_element(elt)
        else:
            self._assert_is_element(element)
        self._children[index] = element

    def __delitem__(self, index):
        del self._children[index]

    def __iter__(self):
        return iter(self._children)

    def append(self, subelement):
        self._assert_is_element(subelement)
        self._children.append(subelement)

    def extend(self, elements):
        for element in elements:
            self._assert_is_element(element)
            self._children.append(element)

    def insert(self, index, subelement):
        self._assert_is_element(subelement)
        self._children.insert(index, subelement)

    def _assert_is_element(self, e):
        if not isinstance(e, Element):
            raise TypeError("expected an Element, not %s" % type(e).__name__)

    def remove(self, subelement):
        for i, child in enumerate(self._children):
            if child is subelement:
                del self._children[i]
                return
        raise ValueError("list.remove(x): x not in list")

    def find(self, path, namespaces=None):
        found = _iterfind(self, path, namespaces)
        return found[0] if found else None

    def findtext(self, path, default=None, namespaces=None):
        e = self.find(path, namespaces)
        if e is None:
            return default
        return e.text or ""

    def findall(self, path, namespaces=None):
        return _iterfind(self, path, namespaces)

    def iterfind(self, path, namespaces=None):
        return iter(_iterfind(self, path, namespaces))

    def clear(self):
        self.attrib.clear()
        self._children = []
        self.text = self.tail = None

    def get(self, key, default=None):
        return self.attrib.get(key, default)

    def set(self, key, value):
        self.attrib[key] = value

    def keys(self):
        return list(self.attrib.keys())

    def items(self):
        return list(self.attrib.items())

    def iter(self, tag=None):
        if tag == "*":
            tag = None
        out = []
        stack = [self]
        while stack:
            e = stack.pop()
            if tag is None or e.tag == tag:
                out.append(e)
            stack.extend(reversed(e._children))
        return iter(out)

    def itertext(self):
        out = []

        def walk(e):
            tag = e.tag
            if not isinstance(tag, str) and tag is not None:
                return
            if e.text:
                out.append(e.text)
            for c in e._children:
                walk(c)
                if c.tail:
                    out.append(c.tail)

        walk(self)
        return iter(out)


def SubElement(parent, tag, attrib={}, **extra):
    attrib = {**attrib, **extra}
    element = parent.makeelement(tag, attrib)
    parent.append(element)
    return element


def Comment(text=None):
    element = Element(Comment)
    element.text = text
    return element


def ProcessingInstruction(target, text=None):
    element = Element(ProcessingInstruction)
    element.text = target
    if text:
        element.text = element.text + " " + text
    return element


PI = ProcessingInstruction


class QName:
    def __init__(self, text_or_uri, tag=None):
        if tag:
            text_or_uri = "{%s}%s" % (text_or_uri, tag)
        self.text = text_or_uri

    def __str__(self):
        return self.text

    def __repr__(self):
        return "<%s %r>" % (self.__class__.__name__, self.text)

    def __hash__(self):
        return hash(self.text)

    def __eq__(self, other):
        if isinstance(other, QName):
            return self.text == other.text
        return self.text == other

    def __lt__(self, other):
        if isinstance(other, QName):
            return self.text < other.text
        return self.text < other


# ── ElementPath: the subset CPython documents — tag, *, ., .., //, [@a], [@a='v'], [tag],
# [tag='text'], [.='text'], [n], [last()], {ns}tag, and prefix:tag with a namespaces mapping ──

_path_tokenizer = re.compile(
    r"('[^']*'|\"[^\"]*\"|::|//?|\.\.|\(\)|!=|[/.*:\[\]\(\)@=])|"
    r"((?:\{[^}]+\})?[^/\[\]\(\)@!=\s]+)|"
    r"\s+"
)


def _tokens(path, namespaces):
    default_ns = namespaces.get("") if namespaces else None
    out = []
    pos = 0
    while pos < len(path):
        m = _path_tokenizer.match(path, pos)
        if not m or m.end() == pos:
            raise SyntaxError("invalid path")
        pos = m.end()
        op, tag = m.group(1), m.group(2)
        if op is None and tag is None:
            continue
        if tag and tag[0] != "{":
            if ":" in tag:
                prefix, uri = tag.split(":", 1)
                if not namespaces or prefix not in namespaces:
                    raise SyntaxError("prefix %r not found in prefix map" % prefix)
                tag = "{%s}%s" % (namespaces[prefix], uri)
            elif default_ns and (not out or out[-1][0] != "@"):
                tag = "{%s}%s" % (default_ns, tag)
        out.append((op or "", tag or ""))
    return out


def _children_tagged(elems, tag):
    out = []
    for e in elems:
        for c in e._children:
            if (tag == "*" and isinstance(c.tag, str)) or c.tag == tag:
                out.append(c)
    return out


def _descendants(elems, tag):
    out = []
    seen = set()
    for e in elems:
        for d in e.iter():
            if d is e:
                continue
            if (tag == "*" and isinstance(d.tag, str)) or d.tag == tag:
                if id(d) not in seen:
                    seen.add(id(d))
                    out.append(d)
    return out


def _parent_map(root):
    pm = {}
    for p in root.iter():
        for c in p._children:
            pm[id(c)] = p
    return pm


def _iterfind(elem, path, namespaces=None):
    if path[-1:] == "/":
        path = path + "*"
    if path[:1] == "/":
        raise SyntaxError("cannot use absolute path on element")
    toks = _tokens(path, namespaces)
    i = 0
    current = [elem]
    pm = None
    while i < len(toks):
        op, tag = toks[i]
        if tag:
            current = _children_tagged(current, tag)
            i += 1
        elif op == "*":
            current = _children_tagged(current, "*")
            i += 1
        elif op == ".":
            i += 1
        elif op == "..":
            if pm is None:
                pm = _parent_map(elem)
            nxt = []
            for e in current:
                p = pm.get(id(e))
                if p is not None and not any(p is x for x in nxt):
                    nxt.append(p)
            current = nxt
            i += 1
        elif op == "//":
            i += 1
            if i >= len(toks):
                raise SyntaxError("invalid descendant")
            op2, tag2 = toks[i]
            if op2 == ".":
                current = current + _descendants(current, "*")
            else:
                current = _descendants(current, tag2 or op2)
            i += 1
        elif op == "/":
            i += 1
        elif op == "[":
            j = i + 1
            sig = []
            while j < len(toks) and toks[j][0] != "]":
                sig.append(toks[j])
                j += 1
            current = _predicate(current, sig, elem)
            i = j + 1
        else:
            raise SyntaxError("invalid path")
    return current


def _unquote(s):
    return s[1:-1]


def _text_of(e):
    return "".join(e.itertext())


def _predicate(elems, sig, root):
    if len(sig) == 2 and sig[0][0] == "@":
        key = sig[1][1]
        return [e for e in elems if e.get(key) is not None]
    if len(sig) == 4 and sig[0][0] == "@" and sig[2][0] in ("=", "!="):
        key = sig[1][1]
        value = _unquote(sig[3][0])
        if sig[2][0] == "=":
            return [e for e in elems if e.get(key) == value]
        return [e for e in elems if e.get(key) is not None and e.get(key) != value]
    if len(sig) == 3 and sig[1][0] in ("=", "!="):
        value = _unquote(sig[2][0])
        want = sig[1][0] == "="
        if sig[0][0] == ".":
            return [e for e in elems if (_text_of(e) == value) == want]
        tag = sig[0][1]
        return [e for e in elems if any((_text_of(c) == value) == want for c in e.findall(tag))]
    if len(sig) == 1 and sig[0][1] and not sig[0][1].isdigit():
        tag = sig[0][1]
        return [e for e in elems if e.find(tag) is not None]
    if (len(sig) == 1 and sig[0][1].isdigit()) or (sig and sig[0][1] == "last"):
        if sig[0][1] == "last":
            index = -1
            if len(sig) > 2:
                index -= int(sig[-1][1])
        else:
            index = int(sig[0][1]) - 1
            if index < 0:
                raise SyntaxError("XPath position >= 1 expected")
        pm = _parent_map(root)
        out = []
        for e in elems:
            p = pm.get(id(e))
            if p is None:
                continue
            sibs = [c for c in p._children if c.tag == e.tag]
            try:
                if sibs[index] is e:
                    out.append(e)
            except IndexError:
                pass
        return out
    raise SyntaxError("invalid predicate")


# ── serialization ──

_namespace_map = {
    "http://www.w3.org/XML/1998/namespace": "xml",
    "http://www.w3.org/1999/xhtml": "html",
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf",
    "http://schemas.xmlsoap.org/wsdl/": "wsdl",
    "http://www.w3.org/2001/XMLSchema": "xs",
    "http://www.w3.org/2001/XMLSchema-instance": "xsi",
    "http://purl.org/dc/elements/1.1/": "dc",
}


def register_namespace(prefix, uri):
    if re.match(r"ns\d+$", prefix):
        raise ValueError("Prefix format reserved for internal use")
    for k, v in list(_namespace_map.items()):
        if k == uri or v == prefix:
            del _namespace_map[k]
    _namespace_map[uri] = prefix


def _escape_cdata(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _escape_attrib(text):
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    return text.replace("\r", "&#13;").replace("\n", "&#10;").replace("\t", "&#09;")


def _escape_attrib_html(text):
    return text.replace("&", "&amp;").replace(">", "&gt;").replace('"', "&quot;")


def _namespaces(elem, default_namespace=None):
    qnames = {None: None}
    namespaces = {}
    if default_namespace:
        namespaces[default_namespace] = ""

    def add_qname(qname):
        if not isinstance(qname, str):
            raise TypeError("cannot serialize %r (type %s)" % (qname, type(qname).__name__))
        if qname[:1] == "{":
            uri, tag = qname[1:].rsplit("}", 1)
            prefix = namespaces.get(uri)
            if prefix is None:
                prefix = _namespace_map.get(uri)
                if prefix is None:
                    prefix = "ns%d" % len(namespaces)
                if prefix != "xml":
                    namespaces[uri] = prefix
            if prefix:
                qnames[qname] = "%s:%s" % (prefix, tag)
            else:
                qnames[qname] = tag
        else:
            if default_namespace:
                raise ValueError("cannot use non-qualified names with default_namespace option")
            qnames[qname] = qname

    for e in elem.iter():
        tag = e.tag
        if isinstance(tag, QName):
            if tag.text not in qnames:
                add_qname(tag.text)
        elif isinstance(tag, str):
            if tag not in qnames:
                add_qname(tag)
        elif tag is not None and tag is not Comment and tag is not ProcessingInstruction:
            raise TypeError("cannot serialize %r (type %s)" % (tag, type(tag).__name__))
        for key, value in e.items():
            if isinstance(key, QName):
                key = key.text
            if key not in qnames:
                add_qname(key)
            if isinstance(value, QName) and value.text not in qnames:
                add_qname(value.text)
        text = e.text
        if isinstance(text, QName) and text.text not in qnames:
            add_qname(text.text)
    return qnames, namespaces


def _write_open(write, elem, tag, qnames, namespaces, escape):
    write("<" + tag)
    items = list(elem.items())
    if namespaces:
        for v, k in sorted(namespaces.items(), key=lambda x: x[1]):
            if k:
                k = ":" + k
            write(' xmlns%s="%s"' % (k, _escape_attrib(v)))
    for k, v in items:
        if isinstance(k, QName):
            k = k.text
        if isinstance(v, QName):
            v = qnames[v.text]
        else:
            v = escape(v)
        write(' %s="%s"' % (qnames[k], v))


def _serialize_xml(write, elem, qnames, namespaces, short_empty_elements):
    tag = elem.tag
    text = elem.text
    if tag is Comment:
        write("<!--%s-->" % text)
    elif tag is ProcessingInstruction:
        write("<?%s?>" % text)
    else:
        tag = qnames[tag.text if isinstance(tag, QName) else tag]
        if tag is None:
            if text:
                write(_escape_cdata(text))
            for e in elem:
                _serialize_xml(write, e, qnames, None, short_empty_elements)
        else:
            _write_open(write, elem, tag, qnames, namespaces, _escape_attrib)
            if text or len(elem) or not short_empty_elements:
                write(">")
                if text:
                    write(_escape_cdata(text))
                for e in elem:
                    _serialize_xml(write, e, qnames, None, short_empty_elements)
                write("</" + tag + ">")
            else:
                write(" />")
    if elem.tail:
        write(_escape_cdata(elem.tail))


HTML_EMPTY = {"area", "base", "basefont", "br", "col", "embed", "frame", "hr", "img", "input",
              "isindex", "link", "meta", "param", "source", "track", "wbr"}


def _serialize_html(write, elem, qnames, namespaces):
    tag = elem.tag
    text = elem.text
    if tag is Comment:
        write("<!--%s-->" % _escape_cdata(text))
    elif tag is ProcessingInstruction:
        write("<?%s?>" % _escape_cdata(text))
    else:
        tag = qnames[tag.text if isinstance(tag, QName) else tag]
        if tag is None:
            if text:
                write(_escape_cdata(text))
            for e in elem:
                _serialize_html(write, e, qnames, None)
        else:
            _write_open(write, elem, tag, qnames, namespaces, _escape_attrib_html)
            write(">")
            ltag = tag.lower()
            if text:
                if ltag == "script" or ltag == "style":
                    write(text)
                else:
                    write(_escape_cdata(text))
            for e in elem:
                _serialize_html(write, e, qnames, None)
            if ltag not in HTML_EMPTY:
                write("</" + tag + ">")
    if elem.tail:
        write(_escape_cdata(elem.tail))


def _read_all(source):
    if hasattr(source, "read"):
        return source.read()
    with open(source, "rb") as f:
        return f.read()


class ElementTree:
    def __init__(self, element=None, file=None):
        self._root = element
        if file:
            self.parse(file)

    def getroot(self):
        return self._root

    def _setroot(self, element):
        self._root = element

    def parse(self, source, parser=None):
        data = _read_all(source)
        if parser is None:
            parser = XMLParser()
        parser.feed(data)
        self._root = parser.close()
        return self._root

    def iter(self, tag=None):
        return self._root.iter(tag)

    def find(self, path, namespaces=None):
        if path[:1] == "/":
            path = "." + path
        return self._root.find(path, namespaces)

    def findtext(self, path, default=None, namespaces=None):
        if path[:1] == "/":
            path = "." + path
        return self._root.findtext(path, default, namespaces)

    def findall(self, path, namespaces=None):
        if path[:1] == "/":
            path = "." + path
        return self._root.findall(path, namespaces)

    def iterfind(self, path, namespaces=None):
        if path[:1] == "/":
            path = "." + path
        return self._root.iterfind(path, namespaces)

    def write(self, file_or_filename, encoding=None, xml_declaration=None, default_namespace=None,
              method=None, *, short_empty_elements=True):
        if not method:
            method = "xml"
        elif method not in ("xml", "html", "text", "c14n"):
            raise ValueError("unknown method %r" % method)
        if not encoding:
            encoding = "utf-8" if method == "c14n" else "us-ascii"
        parts = []
        write = parts.append
        low = encoding.lower()
        if method == "xml" and (xml_declaration or (xml_declaration is None and low != "unicode"
                                                    and low not in ("utf-8", "us-ascii"))):
            write("<?xml version='1.0' encoding='%s'?>\n" % ("utf-8" if low == "unicode" else encoding,))
        if method == "text":
            for part in self._root.itertext():
                write(part)
            if self._root.tail:
                write(self._root.tail)
        else:
            qnames, namespaces = _namespaces(self._root, default_namespace)
            if method == "html":
                _serialize_html(write, self._root, qnames, namespaces)
            else:
                _serialize_xml(write, self._root, qnames, namespaces, short_empty_elements)
        text = "".join(parts)
        data = text if low == "unicode" else text.encode(encoding, "xmlcharrefreplace")
        if hasattr(file_or_filename, "write"):
            file_or_filename.write(data)
        else:
            with open(file_or_filename, "w" if isinstance(data, str) else "wb") as f:
                f.write(data)

    def write_c14n(self, file):
        return self.write(file, method="c14n")


def tostring(element, encoding=None, method=None, *, xml_declaration=None, default_namespace=None,
             short_empty_elements=True):
    stream = io.StringIO() if encoding == "unicode" else io.BytesIO()
    ElementTree(element).write(stream, encoding, xml_declaration=xml_declaration,
                               default_namespace=default_namespace, method=method,
                               short_empty_elements=short_empty_elements)
    return stream.getvalue()


def tostringlist(element, encoding=None, method=None, *, xml_declaration=None, default_namespace=None,
                 short_empty_elements=True):
    return [tostring(element, encoding, method, xml_declaration=xml_declaration,
                     default_namespace=default_namespace, short_empty_elements=short_empty_elements)]


def dump(elem):
    import sys
    if not isinstance(elem, ElementTree):
        elem = ElementTree(elem)
    elem.write(sys.stdout, encoding="unicode")
    tail = elem.getroot().tail
    if not tail or tail[-1] != "\n":
        sys.stdout.write("\n")


def indent(tree, space="  ", level=0):
    if isinstance(tree, ElementTree):
        tree = tree.getroot()
    if level < 0:
        raise ValueError("Initial indentation level must be >= 0, got %s" % level)
    if not len(tree):
        return
    indentations = ["\n" + level * space]

    def _indent_children(elem, level):
        child_level = level + 1
        try:
            child_indentation = indentations[child_level]
        except IndexError:
            child_indentation = indentations[level] + space
            indentations.append(child_indentation)
        if not elem.text or not elem.text.strip():
            elem.text = child_indentation
        child = None
        for child in elem:
            if len(child):
                _indent_children(child, child_level)
            if not child.tail or not child.tail.strip():
                child.tail = child_indentation
        if not child.tail.strip():
            child.tail = indentations[level]

    _indent_children(tree, 0)


# ── parsing ──

class TreeBuilder:
    def __init__(self, element_factory=None, *, comment_factory=None, pi_factory=None,
                 insert_comments=False, insert_pis=False):
        self._data = []
        self._elem = []
        self._last = None
        self._root = None
        self._tail = None
        self._comment_factory = comment_factory if comment_factory is not None else Comment
        self._pi_factory = pi_factory if pi_factory is not None else ProcessingInstruction
        self.insert_comments = insert_comments
        self.insert_pis = insert_pis
        self._factory = element_factory if element_factory is not None else Element

    def close(self):
        if self._root is None:
            raise AssertionError("missing toplevel element")
        return self._root

    def _flush(self):
        if self._data:
            if self._last is not None:
                text = "".join(self._data)
                if self._tail:
                    self._last.tail = text
                else:
                    self._last.text = text
            self._data = []

    def data(self, data):
        self._data.append(data)

    def start(self, tag, attrs):
        self._flush()
        self._last = elem = self._factory(tag, attrs)
        if self._elem:
            self._elem[-1].append(elem)
        elif self._root is None:
            self._root = elem
        self._elem.append(elem)
        self._tail = 0
        return elem

    def end(self, tag):
        self._flush()
        self._last = self._elem.pop()
        self._tail = 1
        return self._last

    def comment(self, text):
        return self._handle_single(self._comment_factory, self.insert_comments, text)

    def pi(self, target, text=None):
        return self._handle_single(self._pi_factory, self.insert_pis, target, text)

    def _handle_single(self, factory, insert, *args):
        elem = factory(*args)
        if insert:
            self._flush()
            self._last = elem
            if self._elem:
                self._elem[-1].append(elem)
            self._tail = 1
        return elem


_XML_ENT = {"lt": "<", "gt": ">", "amp": "&", "quot": '"', "apos": "'"}
_name_re = re.compile(r"[^\s/>=<\"'!?]+")
_attr_re = re.compile(r"\s+([^\s/>=<\"']+)\s*=\s*(\"[^\"]*\"|'[^']*')")
_ref_re = re.compile(r"&(#[0-9]+|#x[0-9a-fA-F]+|[^;&\s]+);")
_decl_enc_re = re.compile(r"""^<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']""")


class XMLParser:
    def __init__(self, *, target=None, encoding=None):
        self.target = target if target is not None else TreeBuilder()
        self._encoding = encoding
        self._buf = []
        self.version = "Expat 2.6.0"
        self.entity = {}
        self._events = None     # (kinds, list) while an XMLPullParser drives it

    def feed(self, data):
        self._buf.append(data)

    def flush(self):
        pass

    def _text(self):
        if not self._buf:
            self._error("no element found", "", 0, 3)
        if isinstance(self._buf[0], (bytes, bytearray)):
            raw = b"".join(bytes(b) for b in self._buf)
            if raw[:3] == b"\xef\xbb\xbf":
                raw = raw[3:]
            enc = self._encoding
            if enc is None:
                m = _decl_enc_re.match(raw[:200].decode("latin-1"))
                enc = m.group(1) if m else "utf-8"
            return raw.decode(enc)
        return "".join(self._buf)

    def _error(self, msg, src, pos, code=None):
        line = src.count("\n", 0, pos) + 1
        col = pos - (src.rfind("\n", 0, pos) + 1)
        err = ParseError("%s: line %d, column %d" % (msg, line, col))
        err.code = code
        err.position = (line, col)
        raise err

    def _refs(self, s, src, pos):
        if "&" not in s:
            return s
        out = []
        last = 0
        for m in _ref_re.finditer(s):
            out.append(s[last:m.start()])
            name = m.group(1)
            if name[0] == "#":
                out.append(chr(int(name[2:], 16) if name[1] == "x" else int(name[1:])))
            elif name in _XML_ENT:
                out.append(_XML_ENT[name])
            elif name in self.entity:
                out.append(self.entity[name])
            else:
                self._error("undefined entity", src, pos + m.start(), 11)
            last = m.end()
        out.append(s[last:])
        return "".join(out)

    def close(self):
        self._run(self._text())
        close = getattr(self.target, "close", None)
        return close() if close is not None else None

    def _expand(self, name, nsmap, src, pos, is_attr=False):
        if ":" in name:
            prefix, local = name.split(":", 1)
            if prefix == "xml":
                return "{http://www.w3.org/XML/1998/namespace}" + local
            uri = nsmap.get(prefix)
            if uri is None:
                self._error("unbound prefix", src, pos, 27)
            return "{%s}%s" % (uri, local)
        if is_attr:
            return name
        uri = nsmap.get("")
        return "{%s}%s" % (uri, name) if uri else name

    def _event(self, kind, value):
        if self._events is not None and kind in self._events[0]:
            self._events[1].append((kind, value))

    def _run(self, src):
        target = self.target
        t_start = getattr(target, "start", None)
        t_end = getattr(target, "end", None)
        t_data = getattr(target, "data", None)
        t_comment = getattr(target, "comment", None)
        t_pi = getattr(target, "pi", None)
        t_start_ns = getattr(target, "start_ns", None)
        t_end_ns = getattr(target, "end_ns", None)
        stack = []            # (raw name, the nsmap outside it, prefixes it declared)
        nsmap = {}
        pos = 0
        n = len(src)
        seen_root = False
        while pos < n:
            lt = src.find("<", pos)
            if lt < 0:
                lt = n
            if lt > pos:
                chunk = src[pos:lt]
                if stack:
                    if t_data is not None:
                        t_data(self._refs(chunk.replace("\r\n", "\n"), src, pos))
                elif chunk.strip():
                    if seen_root:
                        self._error("junk after document element", src, pos, 9)
                    self._error("syntax error", src, pos, 2)
                pos = lt
                if pos >= n:
                    break
            if src.startswith("<!--", pos):
                end = src.find("-->", pos + 4)
                if end < 0:
                    self._error("unclosed token", src, pos, 5)
                if t_comment is not None:
                    r = t_comment(src[pos + 4:end])
                    self._event("comment", r)
                pos = end + 3
            elif src.startswith("<![CDATA[", pos):
                end = src.find("]]>", pos + 9)
                if end < 0:
                    self._error("unclosed CDATA section", src, pos, 20)
                if stack and t_data is not None:
                    t_data(src[pos + 9:end])
                pos = end + 3
            elif src.startswith("<?", pos):
                end = src.find("?>", pos + 2)
                if end < 0:
                    self._error("unclosed token", src, pos, 5)
                parts = src[pos + 2:end].split(None, 1)
                if parts and parts[0].lower() != "xml" and t_pi is not None:
                    r = t_pi(parts[0], parts[1].strip() if len(parts) > 1 else "")
                    self._event("pi", r)
                pos = end + 2
            elif src.startswith("<!", pos):
                depth = 0
                i = pos + 2
                while i < n:
                    c = src[i]
                    if c == "[":
                        depth += 1
                    elif c == "]":
                        depth -= 1
                    elif c == ">" and depth <= 0:
                        break
                    i += 1
                pos = i + 1
            elif src.startswith("</", pos):
                m = _name_re.match(src, pos + 2)
                if not m:
                    self._error("not well-formed (invalid token)", src, pos, 4)
                name = m.group(0)
                end = src.find(">", m.end())
                if end < 0 or src[m.end():end].strip():
                    self._error("not well-formed (invalid token)", src, pos, 4)
                if not stack or stack[-1][0] != name:
                    self._error("mismatched tag", src, pos + 2, 7)
                raw, outer, declared = stack.pop()
                last = t_end(self._expand(name, nsmap, src, pos)) if t_end is not None else None
                self._event("end", last)
                for prefix in declared:
                    if t_end_ns is not None:
                        t_end_ns(prefix)
                    self._event("end-ns", None)
                nsmap = outer
                pos = end + 1
            else:
                m = _name_re.match(src, pos + 1)
                if not m:
                    self._error("not well-formed (invalid token)", src, pos, 4)
                if seen_root and not stack:
                    self._error("junk after document element", src, pos, 9)
                name = m.group(0)
                i = m.end()
                raw_attrs = []
                while True:
                    am = _attr_re.match(src, i)
                    if not am:
                        break
                    raw_attrs.append((am.group(1), am.group(2)[1:-1], am.start(1)))
                    i = am.end()
                while i < n and src[i] in " \t\r\n":
                    i += 1
                empty = False
                if src.startswith("/>", i):
                    empty = True
                    i += 2
                elif i < n and src[i] == ">":
                    i += 1
                else:
                    self._error("not well-formed (invalid token)", src, i, 4)
                outer = nsmap
                declared = []
                attrs = {}
                for an, av, apos in raw_attrs:
                    if an == "xmlns" or an.startswith("xmlns:"):
                        value = self._refs(av, src, apos)
                        if nsmap is outer:
                            nsmap = dict(outer)
                        prefix = an[6:]
                        nsmap[prefix] = value
                        declared.append(prefix)
                        if t_start_ns is not None:
                            t_start_ns(prefix, value)
                        self._event("start-ns", (prefix, value))
                for an, av, apos in raw_attrs:
                    if an == "xmlns" or an.startswith("xmlns:"):
                        continue
                    value = self._refs(av, src, apos)
                    value = value.replace("\t", " ").replace("\n", " ").replace("\r", " ")
                    key = self._expand(an, nsmap, src, apos, True)
                    if key in attrs:
                        self._error("duplicate attribute", src, apos, 8)
                    attrs[key] = value
                tag = self._expand(name, nsmap, src, pos)
                seen_root = True
                elem = t_start(tag, attrs) if t_start is not None else None
                self._event("start", elem)
                if empty:
                    last = t_end(tag) if t_end is not None else None
                    self._event("end", last)
                    for prefix in declared:
                        if t_end_ns is not None:
                            t_end_ns(prefix)
                        self._event("end-ns", None)
                    nsmap = outer
                else:
                    stack.append((name, outer, declared))
                pos = i
        if stack or not seen_root:
            self._error("no element found", src, n, 3)


class XMLPullParser:
    def __init__(self, events=None, *, _parser=None):
        self._queue = []
        self._parser = _parser or XMLParser(target=TreeBuilder())
        self._parser._events = (tuple(events) if events else ("end",), self._queue)
        self.root = None

    def feed(self, data):
        self._parser.feed(data)

    def flush(self):
        pass

    def close(self):
        self.root = self._parser.close()

    def read_events(self):
        queue = self._queue
        while queue:
            yield queue.pop(0)


class _IterParseIterator:
    def __init__(self, events, root):
        self._events = events
        self.root = root

    def __iter__(self):
        return self

    def __next__(self):
        if not self._events:
            raise StopIteration
        return self._events.pop(0)


def iterparse(source, events=None, parser=None):
    # the whole document is read and parsed first, then its events are handed out
    pull = XMLPullParser(events=events, _parser=parser)
    pull.feed(_read_all(source))
    pull.close()
    return _IterParseIterator(list(pull.read_events()), pull.root)


def XML(text, parser=None):
    if not parser:
        parser = XMLParser(target=TreeBuilder())
    parser.feed(text)
    return parser.close()


fromstring = XML


def XMLID(text, parser=None):
    tree = XML(text, parser)
    ids = {}
    for elem in tree.iter():
        id_ = elem.get("id")
        if id_:
            ids[id_] = elem
    return tree, ids


def fromstringlist(sequence, parser=None):
    if not parser:
        parser = XMLParser(target=TreeBuilder())
    for text in sequence:
        parser.feed(text)
    return parser.close()


def parse(source, parser=None):
    tree = ElementTree()
    tree.parse(source, parser)
    return tree


def canonicalize(xml_data=None, *, out=None, from_file=None, **options):
    root = parse(from_file).getroot() if xml_data is None else XML(xml_data)
    text = tostring(root, encoding="unicode", short_empty_elements=False)
    if out is not None:
        out.write(text)
        return None
    return text
