"""adder's compile-time promises and type hints.

    from __adder__ import trust_annotations

at the top of a module (after its docstring and any __future__ imports) is a promise to adder's
compiler, as a __future__ import is a switch for CPython's: here, that the module's int / float /
bool / str / None annotations are true, so the compiled code may type values by them (raw
arithmetic, no helper calls). A flag only lets adder assume something; a program that keeps the
promise runs the same on adder's interpreter, its compiler and CPython.

    from __adder__ import i32, f64

names the compiler's own type hints (i8 … u64, f32, f64). They are always taken as types, with or
without the import; importing them defines the names, which CPython before 3.14 needs to run
`def f(n: i32)` at all.

This file is adder's module and a CPython stub at once: put it beside a program and the same
source runs on CPython, where the flags do nothing and the hints are int and float.
"""

trust_annotations = True

i8 = i16 = i32 = i64 = u8 = u16 = u32 = u64 = int
f32 = f64 = float

__all__ = ['trust_annotations', 'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64', 'f32', 'f64']
