/**
 * Build alnum-tolerant `$and` clauses for free-text job keyword search.
 *
 * - Tokenizes the keyword by whitespace; every token must match (AND).
 * - Each token is normalized (lowercased, non-alphanumerics stripped) then
 *   expanded to a regex tolerating non-alnum chars between letters, so
 *   "react.js", "react-js", "React JS" and "ReactJS" all match each other.
 * - Each token is OR-matched against the provided fields (default: job.name,
 *   skills array, company.name).
 *
 * Returns `null` when the keyword produces no usable tokens (caller can skip
 * adding any filter in that case).
 */
export function buildJobKeywordClauses(
  keyword: string | undefined | null,
  fields: string[] = [
    'name',
    'skills',
    'company.name',
    'category',
    'specialization',
  ],
): Record<string, unknown>[] | null {
  if (!keyword) return null;
  const tokens = String(keyword).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const clauses = tokens
    .map((token) => {
      const normalized = token.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!normalized) return null;
      const pattern = normalized.split('').join('[^a-zA-Z0-9]*');
      const regex = new RegExp(pattern, 'i');
      return { $or: fields.map((field) => ({ [field]: regex })) };
    })
    .filter((clause): clause is NonNullable<typeof clause> => !!clause);

  return clauses.length > 0 ? clauses : null;
}
