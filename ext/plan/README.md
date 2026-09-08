# @gcu/plan

Project scheduling for auditable notebooks and the standalone **plan** tool.
CPM scheduling over working-day calendars, PERT three-point estimation,
Monte Carlo simulation with sensitivity, earned value management, resource
leveling, workflow templates, and report-ready SVG renderers — dependency-free,
in one bundle.

```js
const plan = await load("@gcu/plan");
```

## the task model

A task is a plain object:

```js
{ id: "dev",                       // required, unique
  name: "Development",             // display name (defaults to id)
  group: "Phase 1",                // gantt grouping / WBS bucket
  // duration — pick ONE of:
  duration: 10,                    //   fixed working days
  pert: { o: 5, m: 10, p: 18 },    //   three-point estimate (O/M/P)
  //   (or top-level optimistic / mostLikely / pessimistic — same thing)
  //   neither → a MILESTONE (zero duration, ◆ on the gantt)
  depends: ["design",              // finish-to-start, no lag
            { id: "review", lag: 2 },   // FS + 2 working days of lag
            { id: "proto", lag: -1 }],  // negative lag = lead (overlap)
  resource: "alice",               // resource id (leveling, per-resource calendars)
  start: "2026-04-06",             // optional not-before constraint
  progress: 0.4,                   // 0..1 — feeds EVM / health / burndown
  cost: { rate: 1200 },            // optional $/working-day — EVM costs rate×duration, else duration
}
```

`schedule(tasks, calendar, projectStart)` runs the forward/backward pass and
returns `{ scheduled, criticalPath, projectEnd, projectDuration }` — each
scheduled task carrying `earlyStart`, `earlyFinish`, `lateStart`,
`lateFinish`, `totalFloat`, `freeFloat`, `isCritical`.

```js
const r = plan.schedule(tasks, { weekends: [0, 6], holidays: ["2026-04-03"] }, "2026-03-16");
r.criticalPath                     // ["design", "dev", "test", "deploy"]
r.scheduled.find(t => t.id === "dev").earlyFinish
```

## calendars

A calendar is `{ weekends, holidays, blocked }` — holidays as `"YYYY-MM-DD"`
strings or `{ date, label }`; blocked as `{ start, end, label }` ranges
(shutdowns, vacations). Working-day helpers: `isWorkingDay`,
`addWorkingDays` (negative n walks backward), `workingDays`, `nextWorkingDay`.

A **resource** may carry its own calendar overrides — pass `resources` as the
fourth argument to `schedule` and per-task `resource` ids pick them up.

### Brazilian holidays

```js
const cal = plan.brazilCalendar(2026, 2027, { municipality: "belo horizonte-MG" });
cal.blocked = [{ start: "2026-04-06", end: "2026-04-17", label: "Vacation" }];
plan.brazilMunicipalities();       // all 27 state capitals + Carajás-belt towns
```

Options: `carnival`, `corpusChristi`, `optional` (pontos facultativos).

## Monte Carlo

`monteCarlo(tasks, calendar, projectStart, { iterations = 10000, seed = 42 })`
samples every PERT task per iteration, reschedules, and returns
`projectEnd.p10/p50/p75/p90` (+ mean, stdDev), a `histogram`, per-task
completion percentiles (`taskEnd`), `criticalPathFrequency` (how often each
task landed on the critical path — the real sensitivity ranking), and
correlation-based `sensitivity` for the tornado plot. Deterministic under
`seed`; optional `reworkTransitions` model probabilistic loops.

```js
const mc = plan.monteCarlo(tasks, cal, "2026-03-16", { iterations: 5000, seed: 42 });
mc.projectEnd.p90                   // the date to promise
mc.criticalPathFrequency            // { dev: 0.97, review: 0.31, … }
```

## earned value

`evm(scheduledTasks, statusDate?, calendar?)` — per-task `progress` (0..1) and optional
`cost.rate`/`actualCost` in, `{ pv, ev, ac, bac, spi, cpi, eac, vac }` out. Feed it
`schedule(...).scheduled`.

## analysis functions

Schedule: `whatIf` (change durations, diff the outcome) · `delayImpact` ·
`nearCritical(scheduleResult, maxFloat = 5)` · `slackBudget` · `scopeDrift` ·
`bufferStatus`.
Resource: `busFactor` · `switchingOverhead` · `meetingCost` · `constraint`
(theory-of-constraints utilization).
Models: `brooksLaw` · `littlesLaw` · `multiProjectFragmentation`.
Progress: `burndown` · `health` (composite traffic-light) · `compress`
(crash-cost ranking of critical tasks).

## workflow templates

`instantiate(template, instance)` stamps a reusable stage/transition template
into tasks with prefixed ids (`SP01/drill`, `SP01/assay`, …);
`instantiateBatch` + `compose` chain deposits into one program;
`stageGateMatrix` and `throughput` read progress back across instances.
This is the multi-deposit pattern: one template per deposit type, one
instance per deposit, one schedule for the program.

## renderers

All pure SVG strings, report-ready: `gantt(scheduleResult, { width, showFloat,
showDependencies, showProgress, showResources, showGroups, barColors })` · `scurvePlot` · `resourceHistogram` ·
`monteCarloPlot` · `tornadoPlot` · `burndownPlot` · `deadlineRiskPlot` ·
`stageGateView` · `workflowDiagram`.

## the .plan format & the tool

`parsePlan` / `serializePlan` read and write the tool's `.plan` JSON
(tasks + templates + calendar + deadlines + baseline). `buildSchedulerTasks`
converts the tool's editable rows (string `depends` like `"design+3, review"`,
`%` progress) into scheduler tasks.

The standalone tool (`node build.js --target=plan` → `tools/plan/index.html`)
is a single-file PWA: task grid docked over the gantt (computed Start / Finish
/ Float / ◆ columns), templates editor, calendars, baselines, Monte Carlo,
EVM / health / compress panels, CSV import (paste from Excel) and CSV /
gantt-SVG export. Guard: `npm run test:plan`.

## build & test

```
node ext/plan/build.js      # src/*.js → index.js
node --test test/plan.test.js
```
