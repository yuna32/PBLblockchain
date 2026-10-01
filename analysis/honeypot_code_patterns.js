// HoneyPot 코드축 서브클래스 정적 탐지 (HiddenStateUpdate / StrawManContract).
// analysis/analysis/prevention_reasoner.js 에서 로직 변경 없이 추출했다(2026-10).
// 사용처: analysis/prevention_reasoner.js, analysis/analysis/prevention_reasoner.js(re-export),
// evaluation/honeypot_comparison/*(중첩 reasoner 경유). ontology/load_instances.py 는 같은 로직의
// Python 재구현이므로 여기를 고치면 그쪽도 함께 확인할 것.

// ── HoneyPot 코드축 서브클래스 탐지 (Torres et al. 2019 HoneyBadger 상위 2기법) ──
// evasionSubclasses(다른 4개 사기유형, 신뢰도 점수 기반 — dynamic_analyzer.js
// detectEvasionSubclass 참고)와 달리 순수 불리언 매치다. fraud_type_suspected가
// HoneypotTrap으로 확정된 컨트랙트에 한해 2차 분류로만 실행되며, risk_score/
// risk_level/checklist 등 기존 판정에는 전혀 관여하지 않는 부가 추론이다.

function findWriteLines(varName, lines, excludeLineNo) {
  const re = new RegExp(`\\b${varName}\\s*=(?!=)`);
  const hits = [];
  lines.forEach((line, i) => {
    if (i + 1 === excludeLineNo) return;
    if (re.test(line)) hits.push(i + 1);
  });
  return hits;
}

// HiddenStateUpdate: 해시/시크릿 비교(keccak256/sha3) 가드에 쓰이는 상태변수의
// write 지점이 2개 이상이면, 배포 후 owner가 정답/비밀값을 재설정할 수 있다고 판단.
export function detectHiddenStateUpdate(lines) {
  const guardRe = /\b(\w+)\s*==\s*(?:keccak256|sha3)\s*\(|(?:keccak256|sha3)\s*\([^;]*\)\s*==\s*(\w+)\b/;
  let guardLine = null, guardVar = null;
  for (let i = 0; i < lines.length; i++) {
    const m = guardRe.exec(lines[i]);
    if (m) { guardVar = m[1] || m[2]; guardLine = i + 1; break; }
  }
  if (!guardVar) return { matched: false, evidence: '해시/시크릿 비교 가드 미검출' };

  const writeLines = findWriteLines(guardVar, lines, guardLine);
  if (writeLines.length < 2) {
    return {
      matched: false,
      evidence: `가드 변수 '${guardVar}'(line ${guardLine} 비교) write 지점 ${writeLines.length}개[${writeLines.join(",")}] — 2개 미만`
    };
  }
  return {
    matched: true,
    evidence: `line ${guardLine}에서 상태변수 '${guardVar}' 해시 비교 가드 검출, ` +
      `write 지점 ${writeLines.length}개(line ${writeLines.join(", ")}) — 배포 후 재설정 가능`
  };
}

// 생성자 파라미터가 그대로 상태변수에 대입되는 지점을 찾는다 (위장 컨트랙트 주입 추적용).
// HoneyBadger 실데이터(straw_man_contract 34건)는 전부 Solidity ^0.4.18~ 시절
// 코드라 `constructor` 키워드가 하나도 없다 — 대신 컨트랙트명과 동일한 이름의
// 함수가 생성자 역할을 한다(구버전 문법). 두 경우 모두 지원해야 한다.
function extractConstructorInjectedVars(src, lines) {
  let ctorStart = lines.findIndex(l => /constructor\s*\(/.test(l));
  let ctorPattern = /constructor\s*\(([^)]*)\)/;

  if (ctorStart === -1) {
    const contractNameMatch = /\bcontract\s+(\w+)/.exec(src);
    if (contractNameMatch) {
      const name = contractNameMatch[1];
      const oldCtorRe = new RegExp(`function\\s+${name}\\s*\\(`);
      ctorStart = lines.findIndex(l => oldCtorRe.test(l));
      ctorPattern = new RegExp(`function\\s+${name}\\s*\\(([^)]*)\\)`);
    }
  }
  if (ctorStart === -1) return [];

  let sig = '', i = ctorStart;
  while (i < lines.length && !sig.includes(')')) { sig += lines[i]; i++; }
  const sigMatch = ctorPattern.exec(sig);
  if (!sigMatch || !sigMatch[1].trim()) return [];
  const paramNames = sigMatch[1].split(',').map(p => p.trim().split(/\s+/).pop()).filter(Boolean);

  let depth = 0, bodyStart = -1, bodyEnd = -1;
  for (let j = ctorStart; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') { if (depth === 0) bodyStart = j; depth++; }
      else if (ch === '}') { depth--; if (depth === 0) { bodyEnd = j; break; } }
    }
    if (bodyEnd !== -1) break;
  }
  if (bodyStart === -1 || bodyEnd === -1) return [];

  // RHS may be a bare param (`x = _p;`) or an interface/type cast wrapping it
  // (`x = IFoo(_p);`, `x = address(_p);`) — both are "생성자 파라미터로 주입".
  const escaped  = paramNames.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const assignRe = new RegExp(`\\b(\\w+)\\s*=\\s*(?:\\w+\\s*\\(\\s*)?(${escaped.join('|')})\\s*\\)?\\s*;`);
  const injected = [];
  for (let j = bodyStart; j <= bodyEnd; j++) {
    const m = assignRe.exec(lines[j]);
    if (m) injected.push({ stateVar: m[1], param: m[2], line: j + 1 });
  }
  return injected;
}

// varName에 대입하는 함수가 owner 전용 가드(onlyOwner 모디파이어 또는
// require(msg.sender==...owner...) 형태의 인라인 가드)를 갖는지 확인한다.
// HoneyBadger 실데이터는 대부분 onlyOwner 모디파이어 없이 인라인 require만 쓴다.
function isVarOwnerSettable(varName, src) {
  const assignRe = new RegExp(`\\b${varName}\\s*=\\s*\\w+\\s*;`);
  const funcRe = /function\s+\w+\s*\([^)]*\)[^{;]*\{/g;
  let m;
  while ((m = funcRe.exec(src)) !== null) {
    const braceIdx = src.indexOf('{', m.index);
    let depth = 0, endIdx = -1;
    for (let k = braceIdx; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) { endIdx = k; break; } }
    }
    if (endIdx === -1) continue;
    const sig  = src.slice(m.index, braceIdx);
    const body = src.slice(braceIdx, endIdx);
    if (assignRe.test(body) &&
        (/onlyOwner/i.test(sig) || /require\s*\(\s*msg\.sender\s*==\s*\w*[Oo]wner\w*/.test(body))) {
      return true;
    }
  }
  return false;
}

// StrawManContract: msg.sender 송금 이후 생성자 주입 컨트랙트 변수에 대한 고수준
// 외부호출이 이어지거나(일반형), owner가 세팅 가능한 주소로의 delegatecall이
// 송금문과 인접(delegatecall 변종)하면 매치.
export function detectStrawManContract(src, lines) {
  const injected = extractConstructorInjectedVars(src, lines);

  const sendRe = /(?:payable\([^)]*msg\.sender[^)]*\)|\bmsg\.sender)\s*\.\s*(?:call\s*(?:\{\s*value\s*:|\.value\s*\()|send\s*\()/;
  const sendLines = [];
  lines.forEach((line, i) => { if (sendRe.test(line)) sendLines.push(i + 1); });
  if (sendLines.length === 0) {
    return { matched: false, evidence: 'msg.sender 송금문 미검출' };
  }

  // 일반형(고수준 호출)은 생성자 주입 변수가 있을 때만 해당 — delegatecall
  // 변종은 주입 여부와 무관하게 독립적으로 판정한다(아래).
  const LOW_LEVEL = new Set(['call', 'delegatecall', 'staticcall', 'send', 'transfer']);
  for (const { stateVar, line: injLine } of injected) {
    const callRe = new RegExp(`\\b${stateVar}\\s*\\.\\s*(\\w+)\\s*\\(`);
    for (let i = 0; i < lines.length; i++) {
      const m = callRe.exec(lines[i]);
      if (!m || LOW_LEVEL.has(m[1])) continue;
      const callLine = i + 1;
      if (sendLines.some(sl => callLine > sl)) {
        return {
          matched: true,
          variant: 'general_call',
          evidence: `line ${sendLines.join(",")} 송금 이후 line ${callLine}에서 생성자 ` +
            `주입 변수 '${stateVar}'(line ${injLine} 주입)에 대한 고수준 호출 '${m[1]}()' 검출`
        };
      }
    }
  }

  // delegatecall 변종: owner 전용 세터로 변경 가능한 주소로의 delegatecall이
  // 송금문과 인접. 대상 변수별로 owner 가드를 확인(전역 블랭킷 매치보다 정밀).
  const delegateRe = /(\w+)\s*\.\s*delegatecall\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = delegateRe.exec(lines[i]);
    if (!m) continue;
    const delegateLine = i + 1;
    if (!sendLines.some(sl => Math.abs(sl - delegateLine) <= 1)) continue;
    if (!isVarOwnerSettable(m[1], src)) continue;
    return {
      matched: true,
      variant: 'delegatecall',
      evidence: `line ${delegateLine}의 delegatecall('${m[1]}')이 송금문(line ` +
        `${sendLines.join(",")})과 인접, '${m[1]}'는 owner 전용 세터로 변경 가능한 주소`
    };
  }

  const injectedNote = injected.length > 0
    ? `생성자 주입 변수(${injected.map(x => x.stateVar).join(",")})는 있으나`
    : '생성자 주입 변수 없음,';
  return {
    matched: false,
    evidence: `송금문(line ${sendLines.join(",")})과 ${injectedNote} 고수준 외부호출/delegatecall 변종 미검출`
  };
}
