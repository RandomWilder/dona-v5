# SPEC: calls

**Stub.** Content arrives in its build week — see [tasks/roadmap.md](tasks/roadmap.md); a stub gaining
content is the signal its build has started. Shared conventions live in [SPEC.md](SPEC.md) and are not
repeated here.

- **Owns:** a service call from intake to close, and the visit it produces.
- **Entities:** ServiceCall · Visit, plus the state machine — NEW · IDENTIFIED · TRIAGED ·
  RESPONSIBILITY SET · WINDOWS COLLECTED · OFFERED · SCHEDULED · CLOSED, and the three exits.
- **Depends on:** scope, policy.
- **Builds:** week 7, agent-free and driven by hand from the console; the agent arrives in month three
  without changing any of it.
- **Carries:** **the state machine is deterministic and no model decides a transition.** SLA clocks,
  timers and escalation live here, as does the **emergency bypass**, built in week 7 because it must
  exist before the agent takes its first real message in week 10. `WINDOWS COLLECTED → OFFERED` is
  two-sided asynchronous negotiation between two people never online at once — roughly seventy percent
  of the engineering lives between those two states, and it photographs badly (R5).
