import type { RetrievalResult } from './types.js';

export interface AbstentionDecision {
  answer: boolean;
  reason: 'below_threshold' | 'no_results' | 'ok';
  topScore: number | null;
}

export const decideAbstention = (
  results: RetrievalResult[],
  threshold: number,
): AbstentionDecision => {
  const top = results[0];
  if (!top) return { answer: false, reason: 'no_results', topScore: null };
  if (top.score < threshold)
    return { answer: false, reason: 'below_threshold', topScore: top.score };
  return { answer: true, reason: 'ok', topScore: top.score };
};

export interface AbstentionCounts {
  /** Questions that should abstain (unanswerable) and did. */
  truePositives: number;
  /** Questions that should abstain and did not. */
  falseNegatives: number;
  /** Answerable questions where the system abstained. */
  falsePositives: number;
  trueNegatives: number;
}

export interface AbstentionMetrics {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** Share of answerable questions that were wrongly refused. */
  falseAbstentionRate: number | null;
  counts: AbstentionCounts;
}

export const scoreAbstention = (
  decisions: Array<{ shouldAbstain: boolean; abstained: boolean }>,
): AbstentionMetrics => {
  const counts: AbstentionCounts = {
    truePositives: 0,
    falseNegatives: 0,
    falsePositives: 0,
    trueNegatives: 0,
  };
  for (const decision of decisions) {
    if (decision.shouldAbstain && decision.abstained) counts.truePositives += 1;
    else if (decision.shouldAbstain && !decision.abstained) counts.falseNegatives += 1;
    else if (!decision.shouldAbstain && decision.abstained) counts.falsePositives += 1;
    else counts.trueNegatives += 1;
  }
  const precisionDenominator = counts.truePositives + counts.falsePositives;
  const recallDenominator = counts.truePositives + counts.falseNegatives;
  const precision = precisionDenominator === 0 ? null : counts.truePositives / precisionDenominator;
  const recall = recallDenominator === 0 ? null : counts.truePositives / recallDenominator;
  const answerable = counts.falsePositives + counts.trueNegatives;
  return {
    precision,
    recall,
    f1:
      precision === null || recall === null || precision + recall === 0
        ? null
        : (2 * precision * recall) / (precision + recall),
    falseAbstentionRate: answerable === 0 ? null : counts.falsePositives / answerable,
    counts,
  };
};

/**
 * Picks the threshold that maximizes recall on unanswerable questions subject to
 * a bounded false-abstention rate on answerable ones. Calibrated on the golden
 * set and written to config/abstention.json — never hardcoded by feel.
 */
export const calibrateThreshold = (
  candidates: Array<{ score: number; answerable: boolean }>,
  maxFalseAbstentionRate = 0.15,
): { threshold: number; metrics: AbstentionMetrics } => {
  const scores = [...new Set(candidates.map((item) => Number(item.score.toFixed(4))))].sort(
    (a, b) => a - b,
  );
  const thresholds = [0, ...scores];
  let best: { threshold: number; metrics: AbstentionMetrics; objective: number } | undefined;

  for (const threshold of thresholds) {
    const metrics = scoreAbstention(
      candidates.map((item) => ({
        shouldAbstain: !item.answerable,
        abstained: item.score < threshold,
      })),
    );
    if (
      metrics.falseAbstentionRate !== null &&
      metrics.falseAbstentionRate > maxFalseAbstentionRate
    ) {
      continue;
    }
    const objective = metrics.recall ?? 0;
    if (!best || objective > best.objective) {
      best = { threshold, metrics, objective };
    }
  }

  if (!best) {
    return {
      threshold: 0,
      metrics: scoreAbstention(
        candidates.map((item) => ({ shouldAbstain: !item.answerable, abstained: false })),
      ),
    };
  }
  return { threshold: best.threshold, metrics: best.metrics };
};
