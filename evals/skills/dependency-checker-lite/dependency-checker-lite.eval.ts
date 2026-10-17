import { describeSkill, runSkillCases } from "../../src/index.js";
// Deliberately reuses the full skill's cases — same fixture data, same practices, same
// thresholds. Only the injected skill artifact differs: dependency-checker-lite keeps the
// five-section layout but drops the P0/P1/P2/Info rubric, the internal-vs-external rule, the
// "recommendations, not actions" rule and the references/ files. That makes the pair a
// controlled A/B: pnpm eval:repeat both with labels and compare which practices move.
import { cases } from "../dependency-checker/dependency-checker.cases.js";

describeSkill("dependency-checker-lite", () => runSkillCases("dependency-checker-lite", cases));
