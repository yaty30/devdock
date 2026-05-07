export function formatSqlForDisplay(query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  let formatted = normalized

    .replace(
      /\s+(from|where|group\s+by|order\s+by|having|values|set)\b/gi,

      "\n$1",
    )

    .replace(/\s+(and|or)\s+/gi, "\n      $1 ")

    .replace(/,\s*/g, ",\n    ");

  formatted = formatted.replace(/^select\s+/i, "select\n    ");

  formatted = formatted.replace(
    /\n(from|where|group\s+by|order\s+by|having|values|set)\b/gi,

    (match) => match.toLowerCase(),
  );

  return formatted;
}

export function formatCompactTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  const year = date.getFullYear();

  const month = String(date.getMonth() + 1).padStart(2, "0");

  const day = String(date.getDate()).padStart(2, "0");

  const hours = String(date.getHours()).padStart(2, "0");

  const minutes = String(date.getMinutes()).padStart(2, "0");

  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
