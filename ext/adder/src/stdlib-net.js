// adder stdlib — the network-facing modules libraries import at the top of their files: http
// (HTTPStatus, client, cookiejar, cookies), urllib.request / urllib.error, ssl. adder has no
// sockets (a browser has fetch, not TCP), so the parts that would talk to a server raise a clear
// OSError; the data parts — status codes, header parsing, cookie jars and morsels, proxy-list
// parsing, Request objects — work, so code that builds requests or handles responses runs.
//
// Concat-bundled with the rest of adder: top-level names carry an `_nt` prefix.

import {
  AdderError, adderModules, makeExcType, mkTuple, PyDict, pyRepr, pyIter, adderGetAttr, buildClass,
} from './builtins.js';

const _ntKw = (a) => (a.length && a[a.length - 1] !== null && typeof a[a.length - 1] === 'object' && a[a.length - 1]._kw === true ? a.pop() : {});
const _ntModule = (name, members) => Object.assign({ __adderModule__: true, __name__: name }, members);
const _ntClass = (name, bases, members, module) => { const c = buildClass(name, bases, members, []); c.__module__ = module; return c; };
const _ntNoNet = (what) => new AdderError('OSError', `${what}: no network sockets here (adder runs in a browser; use fetch)`);

// ── http: HTTPStatus ──
const _NT_STATUS = [
  [100, 'CONTINUE', 'Continue', 'Request received, please continue'],
  [101, 'SWITCHING_PROTOCOLS', 'Switching Protocols', 'Switching to new protocol; obey Upgrade header'],
  [102, 'PROCESSING', 'Processing', ''], [103, 'EARLY_HINTS', 'Early Hints', ''],
  [200, 'OK', 'OK', 'Request fulfilled, document follows'], [201, 'CREATED', 'Created', 'Document created, URL follows'],
  [202, 'ACCEPTED', 'Accepted', 'Request accepted, processing continues off-line'],
  [203, 'NON_AUTHORITATIVE_INFORMATION', 'Non-Authoritative Information', 'Request fulfilled from cache'],
  [204, 'NO_CONTENT', 'No Content', 'Request fulfilled, nothing follows'], [205, 'RESET_CONTENT', 'Reset Content', 'Clear input form for further input'],
  [206, 'PARTIAL_CONTENT', 'Partial Content', 'Partial content follows'], [207, 'MULTI_STATUS', 'Multi-Status', ''],
  [208, 'ALREADY_REPORTED', 'Already Reported', ''], [226, 'IM_USED', 'IM Used', ''],
  [300, 'MULTIPLE_CHOICES', 'Multiple Choices', 'Object has several resources -- see URI list'],
  [301, 'MOVED_PERMANENTLY', 'Moved Permanently', 'Object moved permanently -- see URI list'],
  [302, 'FOUND', 'Found', 'Object moved temporarily -- see URI list'], [303, 'SEE_OTHER', 'See Other', 'Object moved -- see Method and URL list'],
  [304, 'NOT_MODIFIED', 'Not Modified', 'Document has not changed since given time'],
  [305, 'USE_PROXY', 'Use Proxy', 'You must use proxy specified in Location to access this resource'],
  [307, 'TEMPORARY_REDIRECT', 'Temporary Redirect', 'Object moved temporarily -- see URI list'],
  [308, 'PERMANENT_REDIRECT', 'Permanent Redirect', 'Object moved permanently -- see URI list'],
  [400, 'BAD_REQUEST', 'Bad Request', 'Bad request syntax or unsupported method'],
  [401, 'UNAUTHORIZED', 'Unauthorized', 'No permission -- see authorization schemes'],
  [402, 'PAYMENT_REQUIRED', 'Payment Required', 'No payment -- see charging schemes'],
  [403, 'FORBIDDEN', 'Forbidden', 'Request forbidden -- authorization will not help'],
  [404, 'NOT_FOUND', 'Not Found', 'Nothing matches the given URI'],
  [405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed', 'Specified method is invalid for this resource'],
  [406, 'NOT_ACCEPTABLE', 'Not Acceptable', 'URI not available in preferred format'],
  [407, 'PROXY_AUTHENTICATION_REQUIRED', 'Proxy Authentication Required', 'You must authenticate with this proxy before proceeding'],
  [408, 'REQUEST_TIMEOUT', 'Request Timeout', 'Request timed out; try again later'], [409, 'CONFLICT', 'Conflict', 'Request conflict'],
  [410, 'GONE', 'Gone', 'URI no longer exists and has been permanently removed'],
  [411, 'LENGTH_REQUIRED', 'Length Required', 'Client must specify Content-Length'],
  [412, 'PRECONDITION_FAILED', 'Precondition Failed', 'Precondition in headers is false'],
  [413, 'CONTENT_TOO_LARGE', 'Content Too Large', 'Content is too large'], [414, 'URI_TOO_LONG', 'URI Too Long', 'URI is too long'],
  [415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported Media Type', 'Entity body in unsupported format'],
  [416, 'RANGE_NOT_SATISFIABLE', 'Range Not Satisfiable', 'Cannot satisfy request range'],
  [417, 'EXPECTATION_FAILED', 'Expectation Failed', 'Expect condition could not be satisfied'],
  [418, 'IM_A_TEAPOT', "I'm a Teapot", 'Server refuses to brew coffee because it is a teapot.'],
  [421, 'MISDIRECTED_REQUEST', 'Misdirected Request', 'Server is not able to produce a response'],
  [422, 'UNPROCESSABLE_CONTENT', 'Unprocessable Content', ''], [423, 'LOCKED', 'Locked', ''],
  [424, 'FAILED_DEPENDENCY', 'Failed Dependency', ''], [425, 'TOO_EARLY', 'Too Early', ''],
  [426, 'UPGRADE_REQUIRED', 'Upgrade Required', ''],
  [428, 'PRECONDITION_REQUIRED', 'Precondition Required', 'The origin server requires the request to be conditional'],
  [429, 'TOO_MANY_REQUESTS', 'Too Many Requests', 'The user has sent too many requests in a given amount of time ("rate limiting")'],
  [431, 'REQUEST_HEADER_FIELDS_TOO_LARGE', 'Request Header Fields Too Large', 'The server is unwilling to process the request because its header fields are too large'],
  [451, 'UNAVAILABLE_FOR_LEGAL_REASONS', 'Unavailable For Legal Reasons', 'The server is denying access to the resource as a consequence of a legal demand'],
  [500, 'INTERNAL_SERVER_ERROR', 'Internal Server Error', 'Server got itself in trouble'],
  [501, 'NOT_IMPLEMENTED', 'Not Implemented', 'Server does not support this operation'],
  [502, 'BAD_GATEWAY', 'Bad Gateway', 'Invalid responses from another server/proxy'],
  [503, 'SERVICE_UNAVAILABLE', 'Service Unavailable', 'The server cannot process the request due to a high load'],
  [504, 'GATEWAY_TIMEOUT', 'Gateway Timeout', 'The gateway server did not receive a timely response'],
  [505, 'HTTP_VERSION_NOT_SUPPORTED', 'HTTP Version Not Supported', 'Cannot fulfill request'],
  [506, 'VARIANT_ALSO_NEGOTIATES', 'Variant Also Negotiates', ''], [507, 'INSUFFICIENT_STORAGE', 'Insufficient Storage', ''],
  [508, 'LOOP_DETECTED', 'Loop Detected', ''], [510, 'NOT_EXTENDED', 'Not Extended', ''],
  [511, 'NETWORK_AUTHENTICATION_REQUIRED', 'Network Authentication Required', 'The client needs to authenticate to gain network access'],
];
// the deprecated aliases CPython keeps
const _NT_STATUS_ALIASES = { REQUEST_ENTITY_TOO_LARGE: 413, REQUEST_URI_TOO_LONG: 414, REQUESTED_RANGE_NOT_SATISFIABLE: 416, UNPROCESSABLE_ENTITY: 422 };

// built on first import: it's an IntEnum (enum must exist by then)
let _ntHttp = null;
function _ntBuildHttp() {
  if (_ntHttp) return _ntHttp;
  const HTTPStatus = adderModules.enum.IntEnum('HTTPStatus', _NT_STATUS.map(([v, n]) => mkTuple([n, v])));
  HTTPStatus.__module__ = 'http';
  for (const [v, n, phrase, description] of _NT_STATUS) {
    const m = HTTPStatus[n];
    Object.assign(m, { phrase, description, is_informational: v < 200, is_success: v >= 200 && v < 300, is_redirection: v >= 300 && v < 400, is_client_error: v >= 400 && v < 500, is_server_error: v >= 500 });
  }
  for (const [alias, v] of Object.entries(_NT_STATUS_ALIASES)) HTTPStatus[alias] = HTTPStatus[_NT_STATUS.find((s) => s[0] === v)[1]];
  const HTTPMethod = adderModules.enum.Enum('HTTPMethod', ['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE'].map((m) => mkTuple([m, m])));
  HTTPMethod.__module__ = 'http';

  // ── http.client ──
  const HTTPException = makeExcType('http.client.HTTPException', 'Exception');
  const exc = (name, parent = 'http.client.HTTPException') => makeExcType(name, parent);
  const excs = {
    HTTPException, NotConnected: exc('NotConnected'), InvalidURL: exc('InvalidURL'), UnknownProtocol: exc('UnknownProtocol'),
    UnknownTransferEncoding: exc('UnknownTransferEncoding'), UnimplementedFileMode: exc('UnimplementedFileMode'),
    IncompleteRead: exc('IncompleteRead'), ImproperConnectionState: exc('ImproperConnectionState'),
    CannotSendRequest: exc('CannotSendRequest', 'ImproperConnectionState'), CannotSendHeader: exc('CannotSendHeader', 'ImproperConnectionState'),
    ResponseNotReady: exc('ResponseNotReady', 'ImproperConnectionState'), BadStatusLine: exc('BadStatusLine'),
    LineTooLong: exc('LineTooLong'),
  };
  excs.RemoteDisconnected = makeExcType('RemoteDisconnected', 'ConnectionResetError', 'BadStatusLine');
  const email = adderModules.email;
  const HTTPMessage = _ntClass('HTTPMessage', [email.message.Message], {
    getallmatchingheaders(self, name) { return (adderGetAttr(self, 'get_all')(name) || []).map((v) => `${name}: ${v}`); },
  }, 'http.client');
  const parse_headers = (fp, ...a) => {
    const kw = _ntKw(a);
    const cls = a[0] || kw._class || HTTPMessage;
    const lines = [];
    const readline = adderGetAttr(fp, 'readline');
    const step = (line) => {
      const t = line instanceof Uint8Array ? adderModules._codecs.decode(line, 'iso-8859-1') : String(line);
      if (t === '' || t === '\r\n' || t === '\n') return email.parser.Parser({ _kw: true, _class: cls }).parsestr(lines.join(''));
      lines.push(t);
      const r = readline(65537);
      return r && typeof r.then === 'function' ? r.then(step) : step(r);
    };
    const r = readline(65537);
    return r && typeof r.then === 'function' ? r.then(step) : step(r);
  };
  const HTTPConnection = _ntClass('HTTPConnection', [], {
    default_port: 80, auto_open: 1, debuglevel: 0, response_class: null,
    __init__(self, host, ...a) {
      const kw = _ntKw(a);
      let port = a.length ? a[0] : kw.port ?? null;
      host = String(host);
      if (port === null && /:\d+$/.test(host)) { port = Number(host.slice(host.lastIndexOf(':') + 1)); host = host.slice(0, host.lastIndexOf(':')); }
      Object.assign(self, { host, port: port ?? self.default_port, timeout: a[1] ?? kw.timeout ?? null, source_address: kw.source_address ?? null, blocksize: kw.blocksize ?? 8192, sock: null, _tunnel_host: null });
      return null;
    },
    set_debuglevel(self, level) { self.debuglevel = level; return null; },
    set_tunnel(self, host, port = null, headers = null) { self._tunnel_host = host; self._tunnel_port = port; self._tunnel_headers = headers; return null; },
    connect(self) { throw _ntNoNet(`connecting to ${self.host}:${self.port}`); },
    close(self) { self.sock = null; return null; },
    request(self, method, url) { throw _ntNoNet(`${method} ${url}`); },
    putrequest(self, method, url) { throw _ntNoNet(`${method} ${url}`); },
    putheader() { throw _ntNoNet('putheader'); }, endheaders() { throw _ntNoNet('endheaders'); },
    send() { throw _ntNoNet('send'); }, getresponse() { throw new AdderError('ResponseNotReady', 'Idle'); },
  }, 'http.client');
  const HTTPSConnection = _ntClass('HTTPSConnection', [HTTPConnection], { default_port: 443 }, 'http.client');
  const HTTPResponse = _ntClass('HTTPResponse', [adderModules.io.BufferedIOBase], {
    __init__(self, sock, ...a) {
      const kw = _ntKw(a);
      Object.assign(self, { fp: null, debuglevel: a[0] ?? kw.debuglevel ?? 0, _method: kw.method ?? null, headers: null, msg: null,
        version: 11, status: null, reason: null, chunked: false, chunk_left: null, length: null, will_close: true });
      return null;
    },
    begin() { throw _ntNoNet('reading a response'); },
    read() { throw _ntNoNet('reading a response'); },
    getheader(self, name, dflt = null) { return self.headers ? adderGetAttr(self.headers, 'get')(name, dflt) : dflt; },
    getheaders(self) { return self.headers ? adderGetAttr(self.headers, 'items')() : []; },
    isclosed(self) { return self.fp === null; }, readable() { return true; },
  }, 'http.client');
  const client = _ntModule('http.client', {
    ...excs, HTTPMessage, HTTPConnection, HTTPSConnection, HTTPResponse, parse_headers,
    HTTP_PORT: 80, HTTPS_PORT: 443, _MAXLINE: 65536, _MAXHEADERS: 100,
    responses: new PyDict(_NT_STATUS.map(([v, , phrase]) => [v, phrase])),
    error: HTTPException,
  });
  for (const [v, n] of _NT_STATUS) client[n] = HTTPStatus[n];

  // ── http.cookiejar ──
  const Cookie = _ntClass('Cookie', [], {
    __init__(self, version, name, value, port, port_specified, domain, domain_specified, domain_initial_dot, path, path_specified, secure, expires, discard, comment, comment_url, rest, rfc2109 = false) {
      Object.assign(self, { version, name, value, port, port_specified, domain: String(domain).toLowerCase(), domain_specified, domain_initial_dot,
        path, path_specified, secure, expires: expires === null || expires === undefined ? null : Math.trunc(expires), discard, comment, comment_url, rfc2109,
        _rest: rest instanceof Map ? new PyDict(rest) : new PyDict(Object.entries(rest || {})) });
      return null;
    },
    has_nonstandard_attr(self, name) { return self._rest.has(name); },
    get_nonstandard_attr(self, name, dflt = null) { return self._rest.has(name) ? self._rest.get(name) : dflt; },
    set_nonstandard_attr(self, name, value) { self._rest.set(name, value); return null; },
    is_expired(self, now = null) { if (now === null) now = Date.now() / 1000; return self.expires !== null && self.expires <= now; },
    __repr__(self) { return `Cookie(version=${pyRepr(self.version)}, name=${pyRepr(self.name)}, value=${pyRepr(self.value)}, domain=${pyRepr(self.domain)}, path=${pyRepr(self.path)})`; },
    __str__(self) { return `<Cookie ${self.name}=${self.value} for ${self.domain}${self.path}>`; },
  }, 'http.cookiejar');
  const CookiePolicy = _ntClass('CookiePolicy', [], {
    set_ok() { return true; }, return_ok() { return true; }, domain_return_ok() { return true; }, path_return_ok() { return true; },
  }, 'http.cookiejar');
  const DefaultCookiePolicy = _ntClass('DefaultCookiePolicy', [CookiePolicy], {
    DomainStrictNoDots: 1, DomainStrictNonDomain: 2, DomainRFC2965Match: 4, DomainLiberal: 0, DomainStrict: 3,
    __init__(self, ...a) {
      const kw = _ntKw(a);
      Object.assign(self, { netscape: kw.netscape ?? true, rfc2965: kw.rfc2965 ?? false, rfc2109_as_netscape: kw.rfc2109_as_netscape ?? null,
        hide_cookie2: kw.hide_cookie2 ?? false, strict_domain: kw.strict_domain ?? false, strict_rfc2965_unverifiable: true,
        strict_ns_unverifiable: false, strict_ns_domain: 0, strict_ns_set_initial_dollar: false, strict_ns_set_path: false, secure_protocols: mkTuple(['https', 'wss']),
        _blocked_domains: mkTuple([...pyIter(kw.blocked_domains || [])]), _allowed_domains: kw.allowed_domains ? mkTuple([...pyIter(kw.allowed_domains)]) : null });
      return null;
    },
    blocked_domains(self) { return self._blocked_domains; }, set_blocked_domains(self, d) { self._blocked_domains = mkTuple([...pyIter(d)]); return null; },
    allowed_domains(self) { return self._allowed_domains; }, set_allowed_domains(self, d) { self._allowed_domains = d === null ? null : mkTuple([...pyIter(d)]); return null; },
    is_blocked(self, domain) { return self._blocked_domains.some((b) => domain === b || (b.startsWith('.') && domain.endsWith(b))); },
    is_not_allowed(self, domain) { return self._allowed_domains !== null && !self._allowed_domains.some((b) => domain === b || (b.startsWith('.') && domain.endsWith(b))); },
  }, 'http.cookiejar');
  // the jar: _cookies[domain][path][name] → Cookie, as CPython keeps it (requests reaches in)
  const each = (self) => { const out = []; for (const paths of self._cookies.values()) for (const names of paths.values()) for (const c of names.values()) out.push(c); return out; };
  const CookieJar = _ntClass('CookieJar', [], {
    __init__(self, policy = null) {
      self._policy = policy === null ? DefaultCookiePolicy() : policy;
      self._cookies_lock = adderModules.threading.RLock();
      self._cookies = new PyDict();
      return null;
    },
    set_policy(self, policy) { self._policy = policy; return null; },
    set_cookie(self, c) {
      if (!self._cookies.has(c.domain)) self._cookies.set(c.domain, new PyDict());
      const paths = self._cookies.get(c.domain);
      if (!paths.has(c.path)) paths.set(c.path, new PyDict());
      paths.get(c.path).set(c.name, c);
      return null;
    },
    set_cookie_if_ok(self, c, request) { return adderGetAttr(self, 'set_cookie')(c); },
    clear(self, domain = null, path = null, name = null) {
      if (name !== null) {
        if (domain === null || path === null) throw new AdderError('ValueError', 'domain and path must be given to remove a cookie by name');
        const n = self._cookies.get(domain)?.get(path);
        if (!n || !n.has(name)) throw new AdderError('KeyError', pyRepr(name));
        n.delete(name);
      } else if (path !== null) {
        if (domain === null) throw new AdderError('ValueError', 'domain must be given to remove cookies by path');
        if (!self._cookies.get(domain)?.delete(path)) throw new AdderError('KeyError', pyRepr(path));
      } else if (domain !== null) {
        if (!self._cookies.delete(domain)) throw new AdderError('KeyError', pyRepr(domain));
      } else self._cookies = new PyDict();
      return null;
    },
    clear_session_cookies(self) { for (const c of each(self)) if (c.discard) adderGetAttr(self, 'clear')(c.domain, c.path, c.name); return null; },
    clear_expired_cookies(self) { const now = Date.now() / 1000; for (const c of each(self)) if (c.expires !== null && c.expires <= now) adderGetAttr(self, 'clear')(c.domain, c.path, c.name); return null; },
    // no network: there are no responses to take cookies from, and a request's Cookie header
    // is the cookies that match it
    extract_cookies() { return null; },
    make_cookies() { return []; },
    add_cookie_header(self, request) {
      const cookies = each(self).filter((c) => !c.is_expired || !adderGetAttr(c, 'is_expired')());
      if (!cookies.length) return null;
      adderGetAttr(request, 'add_unredirected_header')('Cookie', cookies.map((c) => `${c.name}=${c.value}`).join('; '));
      return null;
    },
    __iter__(self) { return each(self)[Symbol.iterator](); },
    __len__(self) { return each(self).length; },
    __repr__(self) { return `<${self.__adderClass__ || 'CookieJar'}[${each(self).map((c) => pyRepr(c)).join(', ')}]>`; },
    __str__(self) { return `<${self.__adderClass__ || 'CookieJar'}[${each(self).map((c) => adderGetAttr(c, '__str__')()).join(', ')}]>`; },
  }, 'http.cookiejar');
  const LoadError = makeExcType('LoadError', 'OSError');
  const FileCookieJar = _ntClass('FileCookieJar', [CookieJar], {
    __init__(self, filename = null, delayload = false, policy = null) { CookieJar.prototype.__init__.call(self, policy); self.filename = filename; self.delayload = delayload; return null; },
    save() { throw new AdderError('NotImplementedError', 'cookie files are not supported here'); },
    load() { throw new AdderError('NotImplementedError', 'cookie files are not supported here'); },
    revert() { throw new AdderError('NotImplementedError', 'cookie files are not supported here'); },
  }, 'http.cookiejar');
  const cookiejar = _ntModule('http.cookiejar', {
    Cookie, CookieJar, CookiePolicy, DefaultCookiePolicy, FileCookieJar, LoadError,
    MozillaCookieJar: _ntClass('MozillaCookieJar', [FileCookieJar], {}, 'http.cookiejar'),
    LWPCookieJar: _ntClass('LWPCookieJar', [FileCookieJar], {}, 'http.cookiejar'),
  });

  // ── http.cookies ──
  const CookieError = makeExcType('CookieError', 'Exception');
  const RESERVED = { expires: 'expires', path: 'Path', comment: 'Comment', domain: 'Domain', 'max-age': 'Max-Age', secure: 'Secure', httponly: 'HttpOnly', version: 'Version', samesite: 'SameSite', partitioned: 'Partitioned' };
  const FLAGS = new Set(['secure', 'httponly', 'partitioned']);
  const Morsel = _ntClass('Morsel', [], {
    _reserved: new PyDict(Object.entries(RESERVED)), _flags: new PySetLike(FLAGS),
    __init__(self) { self._key = null; self._value = null; self._coded_value = null; self._attrs = new PyDict(Object.keys(RESERVED).map((k) => [k, ''])); return null; },
    key: { __property__: true, fget: (self) => self._key, fset: null },
    value: { __property__: true, fget: (self) => self._value, fset: null },
    coded_value: { __property__: true, fget: (self) => self._coded_value, fset: null },
    set(self, key, val, coded) { if (Object.hasOwn(RESERVED, String(key).toLowerCase())) throw new AdderError('CookieError', `Attempt to set a reserved key ${pyRepr(key)}`); self._key = key; self._value = val; self._coded_value = coded; return null; },
    __getitem__(self, k) { const kk = String(k).toLowerCase(); if (!self._attrs.has(kk)) throw new AdderError('KeyError', pyRepr(k)); return self._attrs.get(kk); },
    __setitem__(self, k, v) { const kk = String(k).toLowerCase(); if (!Object.hasOwn(RESERVED, kk)) throw new AdderError('CookieError', `Invalid attribute ${pyRepr(k)}`); self._attrs.set(kk, v); return null; },
    __contains__(self, k) { return self._attrs.has(String(k).toLowerCase()); },
    __iter__(self) { return [...self._attrs.keys()][Symbol.iterator](); },
    __len__(self) { return self._attrs.size; },
    keys(self) { return [...self._attrs.keys()]; }, values(self) { return [...self._attrs.values()]; },
    items(self) { return [...self._attrs.entries()].map((e) => mkTuple(e)); },
    get(self, k, d = null) { const kk = String(k).toLowerCase(); return self._attrs.has(kk) ? self._attrs.get(kk) : d; },
    setdefault(self, k, d = null) { const kk = String(k).toLowerCase(); if (!self._attrs.get(kk)) adderGetAttr(self, '__setitem__')(k, d); return self._attrs.get(kk); },
    update(self, values) { for (const [k, v] of (values instanceof Map ? values : Object.entries(values))) adderGetAttr(self, '__setitem__')(k, v); return null; },
    isReservedKey(self, k) { return Object.hasOwn(RESERVED, String(k).toLowerCase()); },
    OutputString(self, attrs = null) {
      const parts = [`${self._key}=${self._coded_value}`];
      for (const [k, v] of [...self._attrs].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
        if (v === '' || v === null || v === false || (attrs !== null && ![...pyIter(attrs)].includes(k))) continue;
        if (FLAGS.has(k)) { if (v) parts.push(RESERVED[k]); }
        else parts.push(`${RESERVED[k]}=${v}`);
      }
      return parts.join('; ');
    },
    output(self, attrs = null, header = 'Set-Cookie:') { return `${header} ${adderGetAttr(self, 'OutputString')(attrs)}`; },
    __str__(self) { return adderGetAttr(self, 'output')(); },
    __repr__(self) { return `<Morsel: ${adderGetAttr(self, 'OutputString')()}>`; },
  }, 'http.cookies');
  const BaseCookie = _ntClass('BaseCookie', [], {
    __init__(self, input = null) { self._m = new PyDict(); if (input !== null) adderGetAttr(self, 'load')(input); return null; },
    value_decode(self, val) { return mkTuple([val, val]); }, value_encode(self, val) { const s = String(val); return mkTuple([s, s]); },
    __getitem__(self, k) { if (!self._m.has(k)) throw new AdderError('KeyError', pyRepr(k)); return self._m.get(k); },
    __setitem__(self, k, v) {
      if (v && v.__adderType__ === Morsel) { self._m.set(k, v); return null; }
      const [rv, cv] = adderGetAttr(self, 'value_encode')(v);
      const m = self._m.get(k) || Morsel();
      adderGetAttr(m, 'set')(k, rv, cv);
      self._m.set(k, m);
      return null;
    },
    __contains__(self, k) { return self._m.has(k); }, __len__(self) { return self._m.size; },
    __iter__(self) { return [...self._m.keys()][Symbol.iterator](); },
    keys(self) { return [...self._m.keys()]; }, values(self) { return [...self._m.values()]; },
    items(self) { return [...self._m.entries()].map((e) => mkTuple(e)); },
    get(self, k, d = null) { return self._m.has(k) ? self._m.get(k) : d; },
    load(self, rawdata) {
      if (typeof rawdata !== 'string') { for (const [k, v] of (rawdata instanceof Map ? rawdata : Object.entries(rawdata))) adderGetAttr(self, '__setitem__')(k, v); return null; }
      let cur = null;
      for (const part of rawdata.split(';')) {
        const p = part.trim(); if (!p) continue;
        const eq = p.indexOf('=');
        const k = eq < 0 ? p : p.slice(0, eq).trim();
        let v = eq < 0 ? true : p.slice(eq + 1).trim();
        if (typeof v === 'string' && v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
        if (Object.hasOwn(RESERVED, k.toLowerCase())) { if (cur) cur._attrs.set(k.toLowerCase(), v); continue; }
        const [rv, cv] = adderGetAttr(self, 'value_decode')(v);
        cur = Morsel(); adderGetAttr(cur, 'set')(k, rv, cv); self._m.set(k, cur);
      }
      return null;
    },
    output(self, attrs = null, header = 'Set-Cookie:', sep = '\r\n') { return [...self._m.values()].map((m) => adderGetAttr(m, 'output')(attrs, header)).join(sep); },
    __str__(self) { return adderGetAttr(self, 'output')(); },
    __repr__(self) { return `<${self.__adderClass__}: ${[...self._m.entries()].map(([k, m]) => `${k}=${pyRepr(m._value)}`).join(' ')}>`; },
  }, 'http.cookies');
  const SimpleCookie = _ntClass('SimpleCookie', [BaseCookie], {}, 'http.cookies');
  const cookies = _ntModule('http.cookies', { CookieError, Morsel, BaseCookie, SimpleCookie });

  const server = _ntModule('http.server', {
    HTTPServer: _ntClass('HTTPServer', [], { __init__() { throw _ntNoNet('serving HTTP'); } }, 'http.server'),
    BaseHTTPRequestHandler: _ntClass('BaseHTTPRequestHandler', [], {}, 'http.server'),
    SimpleHTTPRequestHandler: _ntClass('SimpleHTTPRequestHandler', [], {}, 'http.server'),
  });
  _ntHttp = _ntModule('http', { HTTPStatus, HTTPMethod, client, cookiejar, cookies, server });
  for (const k of ['client', 'cookiejar', 'cookies', 'server']) adderModules[`http.${k}`] = _ntHttp[k];
  return _ntHttp;
}
// a set-like for Morsel._flags (membership only)
function PySetLike(s) { return { __adderClass__: 'set', __contains__: (k) => s.has(k), __iter__: () => s[Symbol.iterator](), __len__: () => s.size }; }

for (const name of ['http', 'http.client', 'http.cookiejar', 'http.cookies', 'http.server']) {
  Object.defineProperty(adderModules, name, {
    configurable: true, enumerable: false,
    get() { const h = _ntBuildHttp(); return name === 'http' ? h : h[name.slice(5)]; },
    set(v) { Object.defineProperty(adderModules, name, { value: v, writable: true, configurable: true, enumerable: false }); },
  });
}

// ── urllib.error / urllib.request ──
{
  const URLError = makeExcType('URLError', 'OSError');
  const HTTPError = makeExcType('HTTPError', 'URLError');
  const ContentTooShortError = makeExcType('ContentTooShortError', 'URLError');
  const error = _ntModule('urllib.error', { URLError, HTTPError, ContentTooShortError });
  // CPython's parse_http_list: split on commas outside quoted strings
  const parse_http_list = (s) => {
    const res = []; let part = '', esc = false, quote = false;
    for (const ch of String(s)) {
      if (esc) { part += ch; esc = false; continue; }
      if (quote) { if (ch === '\\') { esc = true; continue; } if (ch === '"') quote = false; part += ch; continue; }
      if (ch === ',') { res.push(part); part = ''; continue; }
      if (ch === '"') quote = true;
      part += ch;
    }
    if (part) res.push(part);
    return res.map((p) => p.trim());
  };
  const Request = _ntClass('Request', [], {
    __init__(self, url, ...a) {
      const kw = _ntKw(a);
      self.full_url = String(url);
      self.data = a[0] ?? kw.data ?? null;
      self.headers = new PyDict();
      self.unredirected_hdrs = new PyDict();
      self.origin_req_host = a[2] ?? kw.origin_req_host ?? null;
      self.unverifiable = a[3] ?? kw.unverifiable ?? false;
      self.method = a[4] ?? kw.method ?? null;
      const headers = a[1] ?? kw.headers ?? null;
      if (headers) for (const [k, v] of (headers instanceof Map ? headers : Object.entries(headers))) adderGetAttr(self, 'add_header')(k, v);
      const p = adderModules['urllib.parse'].urlparse(self.full_url);
      self.type = p[0]; self.host = p[1]; self.selector = p[2] + (p[4] ? '?' + p[4] : '');
      return null;
    },
    get_full_url(self) { return self.full_url; },
    get_method(self) { return self.method || (self.data !== null ? 'POST' : 'GET'); },
    add_header(self, k, v) { self.headers.set(String(k).charAt(0).toUpperCase() + String(k).slice(1).toLowerCase(), v); return null; },
    add_unredirected_header(self, k, v) { self.unredirected_hdrs.set(String(k).charAt(0).toUpperCase() + String(k).slice(1).toLowerCase(), v); return null; },
    has_header(self, k) { return self.headers.has(k) || self.unredirected_hdrs.has(k); },
    get_header(self, k, d = null) { return self.headers.has(k) ? self.headers.get(k) : self.unredirected_hdrs.has(k) ? self.unredirected_hdrs.get(k) : d; },
    remove_header(self, k) { self.headers.delete(k); self.unredirected_hdrs.delete(k); return null; },
    header_items(self) { return [...new PyDict([...self.unredirected_hdrs, ...self.headers]).entries()].map((e) => mkTuple(e)); },
    set_proxy(self, host, type) { self.host = host; self.type = type; return null; },
    has_proxy() { return false; },
  }, 'urllib.request');
  const request = _ntModule('urllib.request', {
    Request, parse_http_list,
    parse_keqv_list: (l) => { const d = new PyDict(); for (const elt of pyIter(l)) { const i = elt.indexOf('='); let v = elt.slice(i + 1); if (v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1); d.set(elt.slice(0, i), v); } return d; },
    // no environment to read proxies from: none, and nothing bypasses them
    getproxies: () => new PyDict(), getproxies_environment: () => new PyDict(),
    proxy_bypass: () => false, proxy_bypass_environment: () => false,
    urlopen: (url) => { throw new AdderError('URLError', `<urlopen error ${typeof url === 'string' ? url : 'request'}: no network sockets here (use fetch)>`); },
    urlretrieve: (url) => { throw new AdderError('URLError', `<urlopen error ${url}: no network sockets here (use fetch)>`); },
    build_opener: () => { throw new AdderError('URLError', '<urlopen error: no network sockets here (use fetch)>'); },
    install_opener: () => null,
    pathname2url: (p) => adderModules['urllib.parse'].quote(p),
    url2pathname: (p) => adderModules['urllib.parse'].unquote(p),
    BaseHandler: _ntClass('BaseHandler', [], {}, 'urllib.request'),
    HTTPHandler: _ntClass('HTTPHandler', [], {}, 'urllib.request'),
    HTTPSHandler: _ntClass('HTTPSHandler', [], {}, 'urllib.request'),
    OpenerDirector: _ntClass('OpenerDirector', [], {}, 'urllib.request'),
  });
  adderModules['urllib.error'] = error;
  adderModules['urllib.request'] = request;
  adderModules.urllib = Object.assign(adderModules.urllib || { __adderModule__: true, __name__: 'urllib' }, { error, request });
}

// ── ssl: TLS is the browser's job; the constants and the context class exist ──
{
  const SSLError = makeExcType('SSLError', 'OSError');
  const noTls = (what) => new AdderError('SSLError', `${what}: TLS sockets are not available here (adder runs in a browser; use fetch)`);
  const SSLContext = _ntClass('SSLContext', [], {
    __init__(self, protocol = 16) {
      Object.assign(self, { protocol, verify_mode: 2, check_hostname: protocol === 16, options: 0x82420054, minimum_version: -2, maximum_version: -1,
        verify_flags: 0, post_handshake_auth: null, keylog_filename: null, sni_callback: null, hostname_checks_common_name: false, security_level: 2 });
      return null;
    },
    load_verify_locations() { return null; }, load_cert_chain() { return null; }, load_default_certs() { return null; },
    set_default_verify_paths() { return null; }, set_ciphers() { return null; }, set_alpn_protocols() { return null; },
    set_ecdh_curve() { return null; }, get_ca_certs() { return []; }, get_ciphers() { return []; }, cert_store_stats() { return new PyDict(); },
    wrap_socket() { throw noTls('wrap_socket'); }, wrap_bio() { throw noTls('wrap_bio'); },
  }, 'ssl');
  const ints = (pairs) => Object.fromEntries(pairs);
  const consts = ints([['PROTOCOL_TLS', 2], ['PROTOCOL_SSLv23', 2], ['PROTOCOL_TLS_CLIENT', 16], ['PROTOCOL_TLS_SERVER', 17],
    ['CERT_NONE', 0], ['CERT_OPTIONAL', 1], ['CERT_REQUIRED', 2],
    ['OP_ALL', 0x80000054], ['OP_NO_SSLv2', 0], ['OP_NO_SSLv3', 0x2000000], ['OP_NO_TLSv1', 0x4000000], ['OP_NO_TLSv1_1', 0x10000000],
    ['OP_NO_TLSv1_2', 0x8000000], ['OP_NO_TLSv1_3', 0x20000000], ['OP_NO_COMPRESSION', 0x20000], ['OP_NO_TICKET', 0x4000],
    ['OP_NO_RENEGOTIATION', 0x40000000], ['OP_CIPHER_SERVER_PREFERENCE', 0x400000], ['OP_SINGLE_DH_USE', 0], ['OP_SINGLE_ECDH_USE', 0],
    ['OP_ENABLE_MIDDLEBOX_COMPAT', 0x100000], ['OP_IGNORE_UNEXPECTED_EOF', 0x80],
    ['VERIFY_DEFAULT', 0], ['VERIFY_CRL_CHECK_LEAF', 4], ['VERIFY_CRL_CHECK_CHAIN', 12], ['VERIFY_X509_STRICT', 32], ['VERIFY_X509_PARTIAL_CHAIN', 0x80000],
    ['VERIFY_X509_TRUSTED_FIRST', 0x8000], ['OPENSSL_VERSION_NUMBER', 0x30000000]]);
  adderModules.ssl = _ntModule('ssl', {
    ...consts, SSLContext, SSLError,
    SSLZeroReturnError: makeExcType('SSLZeroReturnError', 'SSLError'), SSLWantReadError: makeExcType('SSLWantReadError', 'SSLError'),
    SSLWantWriteError: makeExcType('SSLWantWriteError', 'SSLError'), SSLSyscallError: makeExcType('SSLSyscallError', 'SSLError'),
    SSLEOFError: makeExcType('SSLEOFError', 'SSLError'), SSLCertVerificationError: makeExcType('SSLCertVerificationError', 'SSLError', 'ValueError'),
    CertificateError: makeExcType('CertificateError', 'SSLError', 'ValueError'),
    SSLSocket: _ntClass('SSLSocket', [], {}, 'ssl'), SSLObject: _ntClass('SSLObject', [], {}, 'ssl'),
    create_default_context: (...a) => SSLContext(16), _create_default_https_context: (...a) => SSLContext(16),
    _create_unverified_context: (...a) => { const c = SSLContext(16); c.check_hostname = false; c.verify_mode = 0; return c; },
    match_hostname: () => null, get_default_verify_paths: () => mkTuple([null, null, null, null, null, null]),
    DER_cert_to_PEM_cert: () => { throw noTls('DER_cert_to_PEM_cert'); }, PEM_cert_to_DER_cert: () => { throw noTls('PEM_cert_to_DER_cert'); },
    HAS_SNI: true, HAS_ALPN: true, HAS_ECDH: true, HAS_NPN: false, HAS_NEVER_CHECK_COMMON_NAME: true,
    HAS_TLSv1: false, HAS_TLSv1_1: false, HAS_TLSv1_2: true, HAS_TLSv1_3: true, HAS_SSLv2: false, HAS_SSLv3: false,
    OPENSSL_VERSION: 'none (adder: TLS is the browser’s)', OPENSSL_VERSION_INFO: mkTuple([3, 0, 0, 0, 0]), CHANNEL_BINDING_TYPES: ['tls-unique'],
  });
  // the enums CPython's ssl defines, built on first use of ssl (enum must exist by then)
  let enums = null;
  const buildEnums = () => {
    if (enums) return enums;
    const E = adderModules.enum;
    enums = {
      TLSVersion: E.IntEnum('TLSVersion', [['MINIMUM_SUPPORTED', -2], ['SSLv3', 768], ['TLSv1', 769], ['TLSv1_1', 770], ['TLSv1_2', 771], ['TLSv1_3', 772], ['MAXIMUM_SUPPORTED', -1]].map((p) => mkTuple(p))),
      VerifyMode: E.IntEnum('VerifyMode', [['CERT_NONE', 0], ['CERT_OPTIONAL', 1], ['CERT_REQUIRED', 2]].map((p) => mkTuple(p))),
      Options: E.IntFlag ? E.IntFlag('Options', [['OP_ALL', 0x80000054]].map((p) => mkTuple(p))) : null,
      Purpose: E.Enum('Purpose', [['SERVER_AUTH', '1.3.6.1.5.5.7.3.1'], ['CLIENT_AUTH', '1.3.6.1.5.5.7.3.2']].map((p) => mkTuple(p))),
    };
    return enums;
  };
  for (const k of ['TLSVersion', 'VerifyMode', 'Options', 'Purpose']) {
    Object.defineProperty(adderModules.ssl, k, { configurable: true, enumerable: true, get() { return buildEnums()[k]; } });
  }
}

// ── select / selectors: no sockets to wait on — the modules exist (and have no poll / epoll,
// which is how libraries pick a strategy); waiting raises ──
adderModules.select = _ntModule('select', {
  select: () => { throw _ntNoNet('select()'); },
  error: adderModules.builtins.OSError,
});
adderModules.selectors = _ntModule('selectors', {
  EVENT_READ: 1, EVENT_WRITE: 2,
  DefaultSelector: _ntClass('DefaultSelector', [], { __init__() { throw _ntNoNet('a selector'); } }, 'selectors'),
  SelectSelector: _ntClass('SelectSelector', [], { __init__() { throw _ntNoNet('a selector'); } }, 'selectors'),
  BaseSelector: _ntClass('BaseSelector', [], {}, 'selectors'),
});
