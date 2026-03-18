/**
 * Token usage tracking per agent invocation, aggregated by phase.
 *
 * Accumulates input/output/total tokens and cost per phase and role,
 * providing per-phase breakdowns and pipeline-wide totals for
 * observability reporting.
 */

// ── Types ───────────────────────────────────────────────────────────

/**
 * Token usage for a single recording unit (one role in one phase).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
}

/**
 * Token usage breakdown for a single phase.
 * byRole maps agent role names to their accumulated usage.
 * total is the sum across all roles for the phase.
 */
export interface PhaseTokenUsage {
  phaseNumber: number;
  byRole: Partial<Record<string, TokenUsage>>;
  total: TokenUsage;
}

// ── Helpers ─────────────────────────────────────────────────────────

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 };
}

function addUsage(target: TokenUsage, source: Partial<TokenUsage>): void {
  target.inputTokens += source.inputTokens ?? 0;
  target.outputTokens += source.outputTokens ?? 0;
  target.totalTokens += source.totalTokens ?? 0;
  // Round to 10 decimal places to avoid floating point accumulation drift
  target.costCents = Math.round((target.costCents + (source.costCents ?? 0)) * 1e10) / 1e10;
}

// ── TokenTracker ────────────────────────────────────────────────────

/**
 * Accumulates token usage per phase and role across a pipeline run.
 *
 * Usage:
 * ```ts
 * const tracker = new TokenTracker();
 * tracker.recordUsage(1, 'executor', { inputTokens: 100, outputTokens: 50, totalTokens: 150, costCents: 0.3 });
 * tracker.getSummary(); // per-phase breakdowns
 * tracker.getTotal();   // pipeline-wide totals
 * ```
 */
export class TokenTracker {
  /** phase number -> role -> accumulated usage */
  private readonly phases = new Map<number, Map<string, TokenUsage>>();

  /**
   * Record token usage for a specific phase and role.
   * Accumulates with any previously recorded usage for the same phase/role.
   *
   * @param phaseNumber - The phase number
   * @param role - The agent role (e.g., 'executor', 'planner')
   * @param usage - Partial token usage to add (missing fields default to 0)
   */
  recordUsage(
    phaseNumber: number,
    role: string,
    usage: Partial<TokenUsage>,
  ): void {
    let roleMap = this.phases.get(phaseNumber);
    if (!roleMap) {
      roleMap = new Map<string, TokenUsage>();
      this.phases.set(phaseNumber, roleMap);
    }

    let existing = roleMap.get(role);
    if (!existing) {
      existing = emptyUsage();
      roleMap.set(role, existing);
    }

    addUsage(existing, usage);
  }

  /**
   * Get per-phase token usage breakdowns, ordered by phase number.
   *
   * @returns Array of PhaseTokenUsage, one per phase with recorded usage
   */
  getSummary(): PhaseTokenUsage[] {
    const result: PhaseTokenUsage[] = [];

    const sortedPhases = [...this.phases.entries()].sort(
      ([a], [b]) => a - b,
    );

    for (const [phaseNumber, roleMap] of sortedPhases) {
      const byRole: Partial<Record<string, TokenUsage>> = {};
      const total = emptyUsage();

      for (const [role, usage] of roleMap) {
        byRole[role] = { ...usage };
        addUsage(total, usage);
      }

      result.push({ phaseNumber, byRole, total });
    }

    return result;
  }

  /**
   * Get pipeline-wide aggregate token usage across all phases and roles.
   *
   * @returns Total TokenUsage for the entire pipeline
   */
  getTotal(): TokenUsage {
    const total = emptyUsage();

    for (const roleMap of this.phases.values()) {
      for (const usage of roleMap.values()) {
        addUsage(total, usage);
      }
    }

    return total;
  }
}
