const LIST_SEPARATOR = ',';
const ESCAPE_CHARACTER = '\\';

/**
 * Decode the foil-color filter's comma-separated form value.
 *
 * Plain comma-separated values remain compatible with existing URLs. A comma
 * or backslash inside one custom color is escaped with a leading backslash.
 */
export function decodeFoilColorFilterValues(
  rawValues: readonly string[],
): string[] {
  return rawValues
    .flatMap(decodeOneList)
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Encode normalized foil colors for form values, links and stored exports. */
export function encodeFoilColorFilterValues(
  values: readonly string[],
): string | undefined {
  if (values.length === 0) return undefined;
  return values.map(escapeListValue).join(LIST_SEPARATOR);
}

function decodeOneList(raw: string): string[] {
  const values: string[] = [];
  let current = '';

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (character === LIST_SEPARATOR) {
      values.push(current);
      current = '';
      continue;
    }
    if (character !== ESCAPE_CHARACTER) {
      current += character;
      continue;
    }

    const next = raw[index + 1];
    if (next === LIST_SEPARATOR || next === ESCAPE_CHARACTER) {
      current += next;
      index += 1;
    } else {
      // Preserve legacy literal backslashes unless they escape a delimiter or
      // another backslash. This keeps old manually-authored URLs meaningful.
      current += ESCAPE_CHARACTER;
    }
  }

  values.push(current);
  return values;
}

function escapeListValue(value: string): string {
  return value
    .replaceAll(ESCAPE_CHARACTER, `${ESCAPE_CHARACTER}${ESCAPE_CHARACTER}`)
    .replaceAll(LIST_SEPARATOR, `${ESCAPE_CHARACTER}${LIST_SEPARATOR}`);
}
