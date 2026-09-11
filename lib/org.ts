/**
 * The firm this deployment works for. Every prompt and UI string that names
 * the firm reads it from here, so retooling for another client means editing
 * this object and nothing else.
 */
export interface OrgProfile {
  /** Full name, used on first mention. */
  name: string;
  /** How prompts and UI refer to the firm after first mention. */
  shortName: string;
  /** What the firm does, as the analysis prompt introduces it. */
  description: string;
}

export const ORG: OrgProfile = {
  name: "ConferenceDirect",
  shortName: "CD",
  description: "a meetings and events company",
};
