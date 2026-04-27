import { describe, expect, it } from "@jest/globals";
import {
  QueryCluster,
  CLUSTER_QUALITY_PROFILES,
  isProfileConsistent,
} from "../../runtime/routing/query-clusters.js";
import { ModelTier, tierIndex } from "../../runtime/routing/model-tiers.js";

const ALL_CLUSTERS = Object.values(QueryCluster);

describe("CLUSTER_QUALITY_PROFILES", () => {
  it("every QueryCluster has a profile entry", () => {
    for (const cluster of ALL_CLUSTERS) {
      expect(CLUSTER_QUALITY_PROFILES[cluster]).toBeDefined();
    }
  });

  it("minViableTier <= preferredTier (ordering consistency)", () => {
    for (const cluster of ALL_CLUSTERS) {
      const profile = CLUSTER_QUALITY_PROFILES[cluster];
      // Lower index = higher tier, so preferred index <= min index
      expect(tierIndex(profile.preferredTier)).toBeLessThanOrEqual(
        tierIndex(profile.minViableTier),
      );
    }
  });

  it("qualityDropoff is in [0, 1] for all clusters", () => {
    for (const cluster of ALL_CLUSTERS) {
      const profile = CLUSTER_QUALITY_PROFILES[cluster];
      expect(profile.qualityDropoff).toBeGreaterThanOrEqual(0);
      expect(profile.qualityDropoff).toBeLessThanOrEqual(1);
    }
  });

  it("isProfileConsistent returns true for all built-in profiles", () => {
    for (const cluster of ALL_CLUSTERS) {
      const profile = CLUSTER_QUALITY_PROFILES[cluster];
      expect(isProfileConsistent(profile)).toBe(true);
    }
  });

  it("isProfileConsistent returns false for invalid profile", () => {
    const bad = {
      minViableTier: ModelTier.PREMIUM,
      preferredTier: ModelTier.ECONOMY,
      qualityDropoff: 0.5,
    };
    expect(isProfileConsistent(bad)).toBe(false);
  });
});

describe("cluster semantics", () => {
  it("trivial clusters have ECONOMY as preferred or minViable", () => {
    const trivialClusters = [
      QueryCluster.FILE_EXPLORATION,
      QueryCluster.COMMAND_EXECUTION,
      QueryCluster.ROUTING_CLASSIFICATION,
    ];
    for (const cluster of trivialClusters) {
      const profile = CLUSTER_QUALITY_PROFILES[cluster];
      expect(profile.preferredTier).toBe(ModelTier.ECONOMY);
    }
  });

  it("complex clusters require at least STANDARD", () => {
    const complexClusters = [
      QueryCluster.CODE_GENERATION,
      QueryCluster.COMPLEX_REFACTOR,
      QueryCluster.CROSS_FILE_REASONING,
      QueryCluster.ERROR_DIAGNOSIS,
    ];
    for (const cluster of complexClusters) {
      const profile = CLUSTER_QUALITY_PROFILES[cluster];
      expect(tierIndex(profile.minViableTier)).toBeLessThanOrEqual(
        tierIndex(ModelTier.STANDARD),
      );
    }
  });
});
