/**
 * Utilities for parsing PromptVault's {{variable}} template syntax.
 *
 * Rules:
 * - Variable names are trimmed and must match the documented identifier pattern.
 * - Results preserve first-appearance order and contain no duplicates.
 * - An escaped opener (\\{{) is treated as literal text.
 * - Invalid or unclosed placeholders are reported instead of silently accepted.
 */

const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,49}$/;

export interface VariableParseResult {
  /** Unique valid variable names in first-appearance order. */
  variables: string[];
  /** Invalid or unclosed placeholder fragments, in source order. */
  malformed: string[];
}

/**
 * Finds valid variable placeholders without rendering or changing the template.
 *
 * Examples:
 *   "Hello {{name}}"       -> ["name"]
 *   "{{ first_name }}"    -> ["first_name"]
 *   "{{x}} {{x}}"         -> ["x"]
 *   "\\{{literal}}"       -> []
 */
export function detectVariables(template: string): VariableParseResult {
  const variables: string[] = [];
  const malformed: string[] = [];
  const seen = new Set<string>();

  let index = 0;

  while (index < template.length) {
    // A backslash immediately before "{{" escapes the opener.
    if (template.startsWith("\\{{", index)) {
      index += 3;
      continue;
    }

    if (!template.startsWith("{{", index)) {
      index += 1;
      continue;
    }

    const closingIndex = template.indexOf("}}", index + 2);

    if (closingIndex === -1) {
      malformed.push(template.slice(index));
      break;
    }

    const fragment = template.slice(index, closingIndex + 2);
    const candidate = template.slice(index + 2, closingIndex).trim();

    // Nested openers are not valid inside a placeholder.
    if (candidate.includes("{{") || !VARIABLE_NAME_PATTERN.test(candidate)) {
      malformed.push(fragment);
    } else if (!seen.has(candidate)) {
      seen.add(candidate);
      variables.push(candidate);
    }

    index = closingIndex + 2;
  }

  return { variables, malformed };
}
