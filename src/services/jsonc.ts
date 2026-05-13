/**
 * Strips comments from JSONC content while respecting string boundaries.
 * Handles // and /* comments, URLs in strings, and escaped quotes.
 * Also removes trailing commas to support more relaxed JSONC format.
 */
// NOSONAR S3776: JSONC comment stripping requires a state machine (string/comment/escape tracking)
// with 4 interleaved states — decomposition into separate functions would create shared mutable state.
export function stripJsoncComments(content: string): string {
  const out: string[] = [];
  let i = 0;
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;

  while (i < content.length) {
    const char = content.charAt(i);
    const nextChar = content.charAt(i + 1);

    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === '"') {
        // Count consecutive backslashes before this quote
        let backslashCount = 0;
        let j = i - 1;
        while (j >= 0 && content[j] === "\\") {
          backslashCount++;
          j--;
        }
        // Quote is escaped only if preceded by ODD number of backslashes
        // e.g., \" = escaped, \\" = not escaped (escaped backslash + quote)
        if (backslashCount % 2 === 0) {
          inString = !inString;
        }
        out.push(char);
        i++;
        continue;
      }
    }

    if (inString) {
      out.push(char);
      i++;
      continue;
    }

    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === "/" && nextChar === "/") {
        inSingleLineComment = true;
        i += 2;
        continue;
      }

      if (char === "/" && nextChar === "*") {
        inMultiLineComment = true;
        i += 2;
        continue;
      }
    }

    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        out.push(char);
      }
      i++;
      continue;
    }

    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (char === "\n") {
        out.push(char);
      }
      i++;
      continue;
    }

    out.push(char);
    i++;
  }

  // Remove trailing commas before } or ]
  return out.join("").replace(/,\s*([}\]])/g, "$1");
}
