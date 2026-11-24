# tools/micro/dev

Developer tools for micro's source tree. Nothing here ships: the build
(`node build.js --target=micro`) follows the imports of `tools/micro/index.html`
and never reads this folder.

**The carve is finished (2026-11-24).** `index.html`'s inline script is now one
line, `import './src/boot.js'`, and `src/boot.js` lists the app's parts in the
order they run. `carve.mjs`, `tostate.mjs`, `unused.mjs` and `hooks.mjs` work on
that inline script, so they have nothing left to read; they stay as the record of
how the carve was done. The hooks the feature modules still receive are set in
`src/viewport.js`. `move.mjs` and `cycles.mjs` work on `src/` and still apply.

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

A carve also leaves behind the imports that only the moved code used. `unused.mjs`
lists and removes them.

## move.mjs

Moves top-level declarations from one `src/` module to another, existing or new.
`carve.mjs` takes code out of the app; this one splits and regroups modules.

```
node tools/micro/dev/move.mjs <from> <to> --names a,b,c [--header "text"] --dry
```

- `--names`: the declarations to move. Each goes to the end of `src/<to>.js` with
  the comment block directly above it, but only the part below the last carve
  pointer (`// (x lives in src/y.js)`) in that block. Whatever stands above a
  pointer belongs to something that moved earlier, or to the section.
- `--header "text"`: the opening comment of `src/<to>.js` when it does not exist
  yet (required then).
- `--dry`: report what would change and write nothing.

What it rewrites:

- `<to>` imports what the moved code used: `<from>`'s imports from the same
  source, and anything that stays in `<from>` from `./<from>.js` (`<from>` gains
  `export` on those). A moved name `<to>` imported from `<from>` becomes local.
  `$` is copied rather than imported.
- What stays in `<from>` and still uses a moved name imports it from `./<to>.js`.
- Every other module, and `index.html`, that imported a moved name from `<from>`
  imports it from `<to>`.
- `<from>` drops the imports only the moved code used.

It refuses, and says why, when a moved name is already bound in `<to>`, when the
moved code wants a name `<to>` binds differently, when either side would assign a
binding the other now owns (an imported binding cannot be written: give the owner
a small function such as `resetJoinForm()` and call that instead), when the moved
code uses the hooks object `H`, on a namespace import of either module, and when a
named declaration shares its statement with one that stays.

The two modules often end up importing each other. Run `cycles.mjs` after a move,
then build and run the smokes. A move can leave exports nobody imports any more;
drop their `export`.

## hooks.mjs

Lists the hooks each module receives from the app and says where each one's target
lives now.

```
node tools/micro/dev/hooks.mjs              # the counts
node tools/micro/dev/hooks.mjs <module>     # one module's hooks
node tools/micro/dev/hooks.mjs --all        # every module's hooks
node tools/micro/dev/hooks.mjs --direct --dry
node tools/micro/dev/hooks.mjs --direct --cycles
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
  depends on this one, directly or through others. Importing it makes the two
  modules import each other. That is allowed under one rule (see `cycles.mjs`
  below), so `--direct` leaves these alone unless `--cycles` is given.

A hook written as a wrapper (`(...a) => fn(...a)`, or `(x, y) => fn(x, y)` with
the same names in the same order) or as a getter with a single `return` counts as
a hook on what it forwards to.

`--direct` converts the stale ones. In the module it replaces `H.<name>` with the
name (or with `S.<prop>`), adds the import, and removes `let H` and the setter when
no hooks remain. In the app it removes the property from the
`set<Module>Hooks({ … })` call, removes the call when it is empty, and drops app
imports that are no longer used. `--only=a,b` limits it to some modules.
`--cycles` converts the `import (cycle)` hooks as well; run `cycles.mjs` afterwards.

It refuses a hook, and says why, when the name it would import is already bound in
the module (a local named `S` blocks every `state` hook of that module: rename the
local first), when the module assigns to the hook, when the app imports the target
under another name, when the module uses the hooks object whole, or when the
module binds `H` a second time (a local named `H`: rename it). Without `--cycles`
it never adds an import that closes a cycle.

## cycles.mjs

Finds the import cycles between the modules in `tools/micro/src` and checks the one
rule that keeps them safe.

```
node tools/micro/dev/cycles.mjs             # the groups, and every breach of the rule
node tools/micro/dev/cycles.mjs --verbose   # also the load-time uses that are fine
node tools/micro/dev/cycles.mjs --why a b   # one chain of imports from a to b
```

Modules that import each other, directly or through others, form a group. ES
modules allow that: every binding exists before any module runs, so a function
that is called later finds its imports filled. What fails is a module that uses a
group sibling's export while it is still loading, because which of the two runs
first depends on where the app's imports enter the group. The dev tree and the
built `micro.html` can enter it at different places, so such a fault can show in
one and not in the other.

The rule: inside a group, no module uses a sibling's export at load time. Exit
code 1 when one does, with the file, the line and the name.

Load time is everything outside a function body, plus:

- a function called where it is written (`(() => { … })()`);
- a function passed to `map`, `forEach`, `filter`, `reduce`, `sort` and the like;
- a class's superclass, static blocks and static fields;
- the body of a top-level function of the module that load-time code calls by
  name. The report names the call that leads there.

A function handed to anything else (`addEventListener`, `setTimeout`, a registry
of commands) is taken to run later. The check reads the source and does not run
it, so it cannot follow a call made through a variable or into another module.

To fix a breach, move the use into a function that runs later, or move what is
used into a module outside the group (`state.js` and the other leaf modules are
outside it). A load-time use of a module outside the group is fine: that module
has always run first.

It runs as `npm run test:micro:cycles`, as the first job of
`node test/micro-smokes.mjs`, and as a CI step.

## tostate.mjs

Turns a top-level variable of the app script into a property of a state object
that a module exports (`S` in `src/state.js` unless told otherwise).

```
node tools/micro/dev/tostate.mjs frame,dirty --dry
node tools/micro/dev/tostate.mjs _paintArm:arm,_paintLastKind:lastKind --obj=PAINT --from=paint
```

`name:property` renames on the way in (`_paintArm` becomes `PAINT.arm`); a bare
name keeps its own.

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

## unused.mjs

Lists the imports of the app script that nothing in it uses, and removes them.

```
node tools/micro/dev/unused.mjs                    # the list, grouped by source
node tools/micro/dev/unused.mjs --prune --dry      # what would be removed
node tools/micro/dev/unused.mjs --prune            # remove all of them
node tools/micro/dev/unused.mjs --prune=a,b        # remove only these
```

A name counts as used when some reference in the script resolves to the module
scope. A parameter, a local or a property key of the same name is not a use, and
neither is a mention in a comment or a string. `--prune=` refuses a name that is
used or is not an import.

A declaration left with no names is removed whole, with the comment at the end of
its line. The module it named is still built when some other module imports it;
check that before removing the last import of a module that is loaded for what it
does at load time. A side-effect import (`import './x.js'`), a default import and
a namespace import are never touched.

`carve.mjs` and `hooks.mjs --direct` do not do this. `hooks.mjs` drops only the
app imports of the names it converted. The first run removed 274
of the app's 773 imports and 17 of its 91 import declarations.

## scope.mjs

The scope resolution the tools share: `parse`, `patIds` (the names a binding
pattern declares) and `moduleRefs` (every reference in a set of statements that
resolves to the module scope).
