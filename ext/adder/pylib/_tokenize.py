"""The tokenizer under tokenize.py, for adder.

CPython 3.12+'s tokenize.py (vendored here verbatim) drives the C tokenizer through
_tokenize.TokenizerIter. adder has no C tokenizer to expose, so this module provides
TokenizerIter with CPython 3.11's pure-Python tokenizer loop (the generator tokenize.py itself
ran until 3.11), over the regular expressions tokenize.py still defines.

Differences from the C tokenizer: f-strings come out as one STRING token (3.11's form, not
3.12's FSTRING_START / FSTRING_MIDDLE / FSTRING_END), and errors are TokenError /
IndentationError as 3.11 raised them.

Adapted from CPython 3.11 Lib/tokenize.py, Copyright (c) Python Software Foundation (PSF
License 2.0, see LICENSE-PSF.txt).
"""


class TokenizerIter:
    """TokenizerIter(readline, *, encoding=None, extra_tokens=False): (type, string, start,
    end, line) tuples. With an encoding, readline gives bytes."""

    def __init__(self, source, *, encoding=None, extra_tokens=False):
        if isinstance(source, str):
            lines = iter(source.splitlines(keepends=True))
            source = lambda: next(lines, '')
        self._gen = _tokenize(source, encoding)

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._gen)


def _tokenize(readline, encoding):
    import tokenize as T
    STRING, ERRORTOKEN, COMMENT, NL, INDENT, DEDENT = T.STRING, T.ERRORTOKEN, T.COMMENT, T.NL, T.INDENT, T.DEDENT
    NUMBER, NEWLINE, NAME, OP, ENDMARKER = T.NUMBER, T.NEWLINE, T.NAME, T.OP, T.ENDMARKER
    _compile, PseudoToken, endpats = T._compile, T.PseudoToken, T.endpats
    single_quoted, triple_quoted, tabsize, TokenError = T.single_quoted, T.triple_quoted, T.tabsize, T.TokenError

    lnum = parenlev = continued = 0
    numchars = '0123456789'
    contstr, needcont = '', 0
    contline = None
    indents = [0]
    strstart = None
    endprog = None

    if encoding == "utf-8-sig":
        # BOM will already have been stripped.
        encoding = "utf-8"
    last_line = ''
    line = ''
    while True:                                # loop over lines in stream
        try:
            last_line = line
            line = readline()
        except StopIteration:
            line = ''

        if encoding is not None and isinstance(line, bytes):
            line = line.decode(encoding)
        lnum += 1
        pos, max = 0, len(line)

        if contstr:                            # continued string
            if not line:
                raise TokenError("EOF in multi-line string", strstart)
            endmatch = endprog.match(line)
            if endmatch:
                pos = end = endmatch.end(0)
                yield (STRING, contstr + line[:end], strstart, (lnum, end), contline + line)
                contstr, needcont = '', 0
                contline = None
            elif needcont and line[-2:] != '\\\n' and line[-3:] != '\\\r\n':
                yield (ERRORTOKEN, contstr + line, strstart, (lnum, len(line)), contline)
                contstr = ''
                contline = None
                continue
            else:
                contstr = contstr + line
                contline = contline + line
                continue

        elif parenlev == 0 and not continued:  # new statement
            if not line: break
            column = 0
            while pos < max:                   # measure leading whitespace
                if line[pos] == ' ':
                    column += 1
                elif line[pos] == '\t':
                    column = (column//tabsize + 1)*tabsize
                elif line[pos] == '\f':
                    column = 0
                else:
                    break
                pos += 1
            if pos == max:
                break

            if line[pos] in '#\r\n':           # skip comments or blank lines
                if line[pos] == '#':
                    comment_token = line[pos:].rstrip('\r\n')
                    yield (COMMENT, comment_token, (lnum, pos), (lnum, pos + len(comment_token)), line)
                    pos += len(comment_token)

                yield (NL, line[pos:], (lnum, pos), (lnum, len(line)), line)
                continue

            if column > indents[-1]:           # count indents or dedents
                indents.append(column)
                yield (INDENT, line[:pos], (lnum, 0), (lnum, pos), line)
            while column < indents[-1]:
                if column not in indents:
                    raise IndentationError(
                        "unindent does not match any outer indentation level",
                        ("<tokenize>", lnum, pos, line))
                indents = indents[:-1]

                yield (DEDENT, '', (lnum, pos), (lnum, pos), line)

        else:                                  # continued statement
            if not line:
                raise TokenError("EOF in multi-line statement", (lnum, 0))
            continued = 0

        while pos < max:
            pseudomatch = _compile(PseudoToken).match(line, pos)
            if pseudomatch:                                # scan for tokens
                start, end = pseudomatch.span(1)
                spos, epos, pos = (lnum, start), (lnum, end), end
                if start == end:
                    continue
                token, initial = line[start:end], line[start]

                if (initial in numchars or                 # ordinary number
                    (initial == '.' and token != '.' and token != '...')):
                    yield (NUMBER, token, spos, epos, line)
                elif initial in '\r\n':
                    if parenlev > 0:
                        yield (NL, token, spos, epos, line)
                    else:
                        yield (NEWLINE, token, spos, epos, line)

                elif initial == '#':
                    assert not token.endswith("\n")
                    yield (COMMENT, token, spos, epos, line)

                elif token in triple_quoted:
                    endprog = _compile(endpats[token])
                    endmatch = endprog.match(line, pos)
                    if endmatch:                           # all on one line
                        pos = endmatch.end(0)
                        token = line[start:pos]
                        yield (STRING, token, spos, (lnum, pos), line)
                    else:
                        strstart = (lnum, start)           # multiple lines
                        contstr = line[start:]
                        contline = line
                        break

                # (a string prefix is up to the first 3 characters: rb', f", …; single quote
                # checking comes after triple quote checking, above)
                elif (initial in single_quoted or
                      token[:2] in single_quoted or
                      token[:3] in single_quoted):
                    if token[-1] == '\n':                  # continued string
                        strstart = (lnum, start)
                        endprog = _compile(endpats.get(initial) or
                                           endpats.get(token[1]) or
                                           endpats.get(token[2]))
                        contstr, needcont = line[start:], 1
                        contline = line
                        break
                    else:                                  # ordinary string
                        yield (STRING, token, spos, epos, line)

                elif initial.isidentifier():               # ordinary name
                    yield (NAME, token, spos, epos, line)
                elif initial == '\\':                      # continued stmt
                    continued = 1
                else:
                    if initial in '([{':
                        parenlev += 1
                    elif initial in ')]}':
                        parenlev -= 1
                    yield (OP, token, spos, epos, line)
            else:
                yield (ERRORTOKEN, line[pos], (lnum, pos), (lnum, pos+1), line)
                pos += 1

    # Add an implicit NEWLINE if the input doesn't end in one
    if last_line and last_line[-1] not in '\r\n' and not last_line.strip().startswith("#"):
        yield (NEWLINE, '', (lnum - 1, len(last_line)), (lnum - 1, len(last_line) + 1), '')
    for indent in indents[1:]:                 # pop remaining indent levels
        yield (DEDENT, '', (lnum, 0), (lnum, 0), '')
    yield (ENDMARKER, '', (lnum, 0), (lnum, 0), '')
