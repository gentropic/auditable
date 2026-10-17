import sys
import unittest

NAME = "__MODULE__"
sys.argv = ["runner"]


def short(err):
    try:
        t, v = err[0], err[1]
        msg = " ".join(str(v).split())[:160]
        return f"{getattr(t, '__name__', t)}: {msg}"
    except BaseException as e:
        return f"<unprintable {type(e).__name__}>"


def out(*a):
    print(*a, flush=True)


suite = None
try:
    mod = __import__("test." + NAME, fromlist=["_"])
except BaseException as e:
    out("IMPORTERROR", short((type(e), e, None)))
else:
    try:
        suite = unittest.TestLoader().loadTestsFromModule(mod)
    except BaseException as e:
        out("LOADERROR", short((type(e), e, None)))
    # a load_tests hook that fails (usually: doctests of a stdlib module adder implements
    # natively) stands for itself — the module's ordinary tests are still loaded and run
    if suite is not None and hasattr(mod, "load_tests"):
        failed = [t for t in suite if type(t).__name__ == "_FailedTest" or (isinstance(t, unittest.TestSuite) and any(type(x).__name__ == "_FailedTest" for x in t))]
        if failed:
            lt = mod.load_tests
            del mod.load_tests
            try:
                suite = unittest.TestSuite([unittest.TestLoader().loadTestsFromModule(mod)] + failed)
            finally:
                mod.load_tests = lt


class R(unittest.TestResult):
    def startTest(self, test):
        super().startTest(test)
        out("START", test.id())

    def addSuccess(self, test):
        out("PASS", test.id())

    def addFailure(self, test, err):
        out("FAIL", test.id(), short(err))

    def addError(self, test, err):
        out("ERROR", test.id(), short(err))

    def addSkip(self, test, reason):
        out("SKIP", test.id(), " ".join(str(reason).split())[:120])

    def addExpectedFailure(self, test, err):
        out("PASS", test.id())

    def addUnexpectedSuccess(self, test):
        out("FAIL", test.id(), "unexpected success")

    def addSubTest(self, test, subtest, err):
        if err is not None:
            kind = "FAIL" if issubclass(err[0], test.failureException) else "ERROR"
            out("SUBFAIL", test.id(), kind, short(err))


if suite is not None:
    suite.run(R())
    out("DONE")
