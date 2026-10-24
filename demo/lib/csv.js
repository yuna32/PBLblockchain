// 시뮬레이션 CSV(8열, 따옴표·이스케이프 없음) 파서.
// 저장소 로그는 CRLF, 새 시뮬레이션 로그는 LF라서 CR을 모두 지우고 빈 줄은 버린다.

export function splitCsvLines(text) {
  return text.replace(/\r/g, "").split("\n").filter(line => line.length > 0);
}

// 값은 문자열 그대로 둔다(분석기 parseCSV와 같은 형태).
export function parseCsv(text) {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
  });
}
