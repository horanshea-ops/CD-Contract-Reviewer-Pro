/**
 * The multi-round diff engine (MASTER_PLAN.md §2.1.1).
 *
 * It answers one question — what is different between the version we sent and
 * the version that came back, and which clause does each difference sit in. It
 * does not decide whether a finding was accepted, rejected or countered. That
 * is §2.1.2, which is gated, and nothing here reads or writes a finding.
 */
export * from "./projection";
export * from "./diff";
export * from "./attribution";
export * from "./compare";
export * from "./rounds";
