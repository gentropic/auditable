# tools/micro/dev

Developer tools for micro's source tree. Nothing here ships: the build
(`node build.js --target=micro`) follows the imports of `tools/micro/index.html`
and never reads this folder.

## carve.mjs

Moves top-level declarations out of the inline module script in
`tools/micro/index.html` into a new `tools/micro/src/<module>.js`. It parses the
script, so it moves what the scope rules allow and refuses the rest.

```
node tools/micro/dev/carve.mjs <module> --names a,b,c --hooks x,y --dry
```

- `--names`: the declarations to move (functions, `const`/`let` statements). Each
  goes with the comment block directly above it and is exported.
- `--hooks`: names the moved code uses that stay in the app. The module reads them
  as `H.<name>`; the app passes them in once through `set<Module>Hooks({ … })`.
- `--getters`: the same, for a `let` the app reassigns. The hook is a getter, so
  the module always reads the current value.
- `--local '<name>=<expression>'`: define a small helper inside the new module
  instead of hooking it.
- `--header "text"`: the comment at the top of the new file.
- `--dry`: report what would move and change nothing.

It refuses, and says why, when the moved code refers to an app name that is not
moved, imported, hooked or local; when the module file already exists; when a
named declaration shares its statement with one that stays; when the moved code
assigns to a hook; or when the app still assigns to a name being moved.

After a carve, build and run the smokes:

```
node test/micro-smokes.mjs --build
```

A hook is a stopgap. Once the thing it points at lives in a module of its own, the
module that needed the hook should import it directly.
