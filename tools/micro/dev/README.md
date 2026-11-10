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
module that needed the hook should import it directly. `hooks.mjs` finds those and
converts them.

## hooks.mjs

Lists the hooks each module receives from the app and says where each one's target
lives now.

```
node tools/micro/dev/hooks.mjs              # the counts
node tools/micro/dev/hooks.mjs <module>     # one module's hooks
node tools/micro/dev/hooks.mjs --all        # every module's hooks
node tools/micro/dev/hooks.mjs --direct --dry
```

Each hook is one of three kinds:

- `app`: the target is still declared in `tools/micro/index.html`. The hook is needed
  until the target moves to a module.
- `import`: the target is exported by a module, and importing it would not close an
  import cycle. The hook is stale.
- `import (cycle)`: the target is exported by a module, but that module already
  depends on this one, directly or through others.

`--direct` converts the stale ones. In the module it replaces `H.<name>` with the
name, adds the import, and removes `let H` and the setter when no hooks remain. In
the app it removes the property from the `set<Module>Hooks({ … })` call, removes the
call when it is empty, and drops app imports that are no longer used. `--only=a,b`
limits it to some modules.

It refuses a hook, and says why, when the name is already bound in the module, when
the module assigns to the hook, when the app imports the target under another name,
or when the module uses the hooks object whole. It never adds an import that closes
a cycle.

A hook whose value is an arrow function (`(...a) => fn(...a)`) counts as `app` even
when `fn` lives in a module. Those need a look by hand.
