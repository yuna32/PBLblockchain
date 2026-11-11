// 리포트 변조 확인 화면의 용어 한 줄 설명. 각 행 아래 회색 작은 글씨로 붙인다(해당 행이 화면에 있을 때만).
// hash_excluded: 화면에 나오는 필드는 envelope.report_hash_excluded (timestamp, dynamic.csv, trust.csv, static.file).
//   값은 분석 시각과 입력 파일 이름(경로 아님)이므로 그에 맞춰 쓴다.
export const REPORT_HELP = {
  report_hash:   "리포트 내용으로 만든 지문 값이에요. 한 글자만 바뀌어도 완전히 달라집니다.",
  envelope:      "envelope: 분석할 때 리포트와 함께 적어 둔 기록(해시와 입력 파일 정보)",
  canonical_version: "해시를 내기 전에 리포트를 늘 같은 순서와 형식의 글자로 바꾸는 규칙",
  hash_excluded: "분석 시각(timestamp)과 입력 파일 이름(dynamic.csv · trust.csv · static.file)은 분석 결과가 아니라 실행 정보라서 비교에서 뺐습니다.",
  canonical:     "직렬화 규칙대로 바꾼 리포트 원문",
  uid:           "체인에 남긴 기록의 번호",
  txHash:        "그 기록을 남긴 거래의 번호"
};
