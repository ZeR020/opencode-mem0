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
    const next = content.charAt(i + 1);

    if (inString) {
      if (char === '"') {
        let backslashes = 0;
        let j = i - 1;
        while (j >= 0 && content[j] === "\\") {
          backslashes++;
          j--;
        }
        if (backslashes % 2 === 0) inString = false;
      }
      out.push(char);
      i++;
      continue;
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
      if (char === "*" && next === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (char === "\n") out.push(char);
      i++;
      continue;
    }

    if (char === '"') {
      inString = true;
      out.push(char);
      i++;
      continue;
    }

    if (char === "/" && next === "/") {
      inSingleLineComment = true;
      i += 2;
      continue;
    }

    if (char === "/" && next === "*") {
      inMultiLineComment = true;
      i += 2;
      continue;
    }

    out.push(char);
    i++;
  }

  return out.join("").replace(/,\s*([}\]])/g, "$1");
}
