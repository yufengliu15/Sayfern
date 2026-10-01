// A harness under test. Adapters stay thin: they only drive the harness through
// its public surface (Sayfern's SayfernApi, Claude Code's CLI). Measurement
// happens outside, at the model API proxy and the AnkiConnect server.
import type { BenchConfig } from "../config";
import type { Sandbox } from "../fixtures";
import type { Scenario, ScenarioSession } from "../scenarios";
import type { TurnOutput } from "../types";

export interface ArmContext {
  config: BenchConfig;
  scenario: Scenario;
  sandbox: Sandbox;
  /** Directory for this (arm, scenario, rep): harness data, logs. */
  runDir: string;
  proxyUrl: string;
  ankiUrl: string;
  model: string;
  log(msg: string): void;
}

export interface Arm {
  readonly id: string;
  readonly label: string;
  /** Harness version string for the report (app version, CLI version). */
  version(): Promise<string>;
  supports(scenario: Scenario): string | null;
  setup(ctx: ArmContext): Promise<void>;
  /** Starts a session. Returns the tutor's opening, or null when the harness has no opening turn for this mode. */
  open(session: ScenarioSession, index: number): Promise<TurnOutput | null>;
  send(text: string): Promise<TurnOutput>;
  /** Ends the session the way a learner would. null when ending costs nothing observable. */
  end(): Promise<TurnOutput | null>;
  teardown(): Promise<void>;
}
