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

Each hook is one of four kinds:

- `app`: the target is still declared in `tools/micro/index.html`. The hook is needed
  until the target moves to a module.
- `import`: the target is exported by a module, and importing it would not close an
  import cycle. The hook is stale.
- `state`: the target is a property of the state object. The app holds it in a
  top-level `const` and also assigns that `const` to `S.<prop>` (`S.renderer =
  renderer;`), or the hook is a getter that returns `S.<prop>`. The module can read
  `S.<prop>` itself. The hook is stale.
- `import (cycle)`: the target is exported by a module, but that module already
  depends on this one, directly or through others.

A hook written as a wrapper (`(...a) => fn(...a)`) or as a getter with a single
`return` counts as a hook on what it forwards to.

`--direct` converts the stale ones. In the module it replaces `H.<name>` with the
name (or with `S.<prop>`), adds the import, and removes `let H` and the setter when
no hooks remain. In the app it removes the property from the
`set<Module>Hooks({ … })` call, removes the call when it is empty, and drops app
imports that are no longer used. `--only=a,b` limits it to some modules.

It refuses a hook, and says why, when the name it would import is already bound in
the module (a local named `S` blocks every `state` hook of that module: rename the
local first), when the module assigns to the hook, when the app imports the target
under another name, or when the module uses the hooks object whole. It never adds
an import that closes a cycle.

## tostate.mjs

Turns a top-level variable of the app script into a property of a state object
that a module exports (`S` in `src/state.js` unless told otherwise).

```
node tools/micro/dev/tostate.mjs frame,dirty --dry
node tools/micro/dev/tostate.mjs secMode,secPos --obj=SEC --from=sections
```

Add the property to the state object first, with its comment. Then the tool
rewrites every reference that resolves to the variable into `<obj>.<name>`,
removes the declaration (or turns it into an assignment, when the app starts the
variable with a value other than the one in the state object), and adds the
import. References are resolved by scope, so a parameter, a local or a property
key of the same name is left alone, and `{ name }` becomes `{ name: <obj>.<name> }`.

It refuses, and says why, when the property is missing from the state object,
when `<obj>` is bound to something else where a reference stands, when the name is
a function, a class or an import, or when a declaration that must become an
assignment shares its statement with others.

Once a variable is a state property, a module no longer needs a getter hook to
read it. Run `hooks.mjs --direct` afterwards.

## scope.mjs

The scope resolution the three tools share: `parse`, `patIds` (the names a binding
pattern declares) and `moduleRefs` (every reference in a set of statements that
resolves to the module scope).
