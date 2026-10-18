"""importlib._bootstrap_external for adder: the file loaders and helpers tools reach for here
(pydoc's SourceFileLoader / SourcelessFileLoader), from adder's importlib.machinery.

Not CPython's module (that one implements the path-based import system); see _bootstrap.py.
"""

from importlib.machinery import SourceFileLoader, SourcelessFileLoader, ExtensionFileLoader
from importlib.util import cache_from_source, source_from_cache, spec_from_file_location, MAGIC_NUMBER

SOURCE_SUFFIXES = ['.py']
BYTECODE_SUFFIXES = ['.pyc']
EXTENSION_SUFFIXES = []
