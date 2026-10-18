"""importlib._bootstrap for adder: the few names code outside the import system reaches for.

CPython's _bootstrap.py *is* its import system; adder's import system is its own (JS), so this
is not CPython's module, only its public-ish surface that tools use (pydoc's _load).
"""

import sys
from importlib.machinery import ModuleSpec
from importlib.util import module_from_spec, spec_from_loader


def _load(spec):
    """Load and return the module the spec describes, registered in sys.modules (as CPython's
    _bootstrap._load does — a module already there is reloaded into)."""
    module = module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        if spec.loader is not None and hasattr(spec.loader, 'exec_module'):
            spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(spec.name, None)
        raise
    return sys.modules[spec.name]


def _find_spec(name, path, target=None):
    from importlib.util import find_spec
    return find_spec(name)
