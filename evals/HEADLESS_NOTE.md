# Headless `claude -p` end-to-end evals: not run

The plan's Phase 7 stretch goal asks for 2-3 scenarios run end-to-end via `claude -p` headless mode with the plugin loaded in a temp dir, in addition to the fixture-based evals.

`claude -p` is confirmed available in this environment. It was not run for this build because doing so means spawning a nested Claude Code session from inside the session doing this build, which:
- consumes the user's own API usage for a check the fixture evals already cover functionally (all 10/10 fixture scenarios pass against the real hook scripts via real stdin/stdout, not mocked internals), and
- introduces a second, less controllable process that could behave unpredictably (e.g. an inner agent deciding to take other actions) inside an autonomous build run.

This was a judgment call to skip a stretch goal rather than a failure — flagging it plainly per plan's own principle of not padding results. If true end-to-end validation (real Claude Code loading the plugin via a marketplace install, not fixture JSON) is wanted, it should be run manually, once, by the user reviewing this build.
